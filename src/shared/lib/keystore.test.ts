import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDEK, toBase64 } from "./crypto";
import * as keystore from "./keystore";
import * as api from "./storeClient";

vi.mock("./storeClient", () => ({ putKeystore: vi.fn(), getKeystore: vi.fn() }));
const create = vi.fn();
const get = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("location", { hostname: "wingman.example" });
  vi.stubGlobal("navigator", { credentials: { create, get } });
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const credential = (prf: object) => ({
    type: "public-key",
    rawId: new Uint8Array([1]).buffer,
    getClientExtensionResults: () => ({ prf }),
  });
  create.mockResolvedValue(credential({ enabled: true }));
  get.mockResolvedValue(credential({ results: { first: secret.buffer } }));
  vi.mocked(api.putKeystore).mockResolvedValue("next-etag");
});
afterEach(() => vi.unstubAllGlobals());

describe("keystore protection methods", () => {
  it("switches plain → passkey → PIN without changing the encryption key", async () => {
    const dek = await generateDEK(5);
    const initial: keystore.KeystoreState = {
      etag: "initial-etag",
      keystore: { version: 2, kid: 5, pinProtected: false, dek: toBase64(dek.raw) },
    };
    const passkey = await keystore.setPasskey(initial, dek, "alice");
    expect(keystore.isProtected(passkey.keystore)).toBe(true);
    expect(keystore.isPasskeyProtected(passkey.keystore)).toBe(true);
    expect(api.putKeystore).toHaveBeenCalledWith(JSON.stringify(passkey.keystore), {
      ifMatch: "initial-etag",
    });
    expect(JSON.stringify(passkey.keystore)).not.toContain(toBase64(dek.raw));
    await expect(keystore.unlockWithPin(passkey, "", "alice")).rejects.toThrow(/passkey/);
    expect(await keystore.unlockWithPasskey(passkey, "alice")).toEqual(dek);
    const pin = await keystore.setPin(passkey, dek, "123456", "alice");
    expect(keystore.isPasskeyProtected(pin.keystore)).toBe(false);
    expect(await keystore.unlockWithPin(pin, "123456", "alice")).toEqual(dek);
    const again = await keystore.setPasskey(pin, dek, "alice");
    expect(await keystore.unlockWithPasskey(again, "alice")).toEqual(dek);
  });

  it("does not upload anything when enrollment is cancelled or PRF is unsupported", async () => {
    const dek = await generateDEK();
    const initial: keystore.KeystoreState = {
      etag: "initial",
      keystore: { version: 2, kid: 1, pinProtected: false, dek: toBase64(dek.raw) },
    };
    create.mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
    await expect(keystore.setPasskey(initial, dek, "alice")).rejects.toThrow();
    get.mockResolvedValue(null);
    await expect(keystore.setPasskey(initial, dek, "alice")).rejects.toThrow();
    expect(api.putKeystore).not.toHaveBeenCalled();
  });

  it("propagates CAS conflicts without replacing the current protected state", async () => {
    const dek = await generateDEK();
    const initial: keystore.KeystoreState = {
      etag: "initial",
      keystore: { version: 2, kid: 1, pinProtected: false, dek: toBase64(dek.raw) },
    };
    await keystore.setPasskey(initial, dek, "alice");
    vi.mocked(api.putKeystore).mockClear();
    vi.mocked(api.putKeystore).mockRejectedValueOnce(new Error("Keystore changed on another device"));
    await expect(keystore.setPasskey(initial, dek, "alice")).rejects.toThrow(/another device/);
    expect(initial.etag).toBe("initial");
  });
});

describe("automatic upload key provisioning", () => {
  it("keeps only the public key locally and preserves the backup key through protection changes", async () => {
    const { MemoryOpfs } = await import("./test-support/memoryOpfs");
    const memory = new MemoryOpfs();
    vi.stubGlobal("navigator", { credentials: { create, get }, storage: { getDirectory: async () => memory.root } });
    const dek = await generateDEK(3);
    const initial: keystore.KeystoreState = {
      etag: "initial",
      keystore: { version: 2, kid: 3, pinProtected: false, dek: toBase64(dek.raw) },
    };
    const pin = await keystore.setPin(initial, dek, "123456", "alice");
    const upgraded = await keystore.enableBackupUploads(pin, dek, "alice");
    const publicOnly = await keystore.uploadKey(upgraded.state, "alice");
    expect(publicOnly?.backup.privateKey).toBeUndefined();
    expect(publicOnly?.raw).toBeUndefined();
    expect(JSON.stringify(upgraded.state)).not.toContain(toBase64(dek.raw));
    const cache = await memory.files.get("_sync/upload-key.json")!.text();
    expect(Object.keys(JSON.parse(cache)).sort()).toEqual(["kid", "publicKey", "userId"]);
    const passkey = await keystore.setPasskey(upgraded.state, upgraded.dek, "alice");
    expect(passkey.keystore.backup).toEqual(upgraded.state.keystore.backup);
    const restoredRoot = await keystore.unlockWithPasskey(passkey, "alice");
    const restored = await keystore.enableBackupUploads(passkey, restoredRoot, "alice");
    const { encryptBlob, decryptBlob } = await import("./crypto");
    const bytes = new Uint8Array([1, 2, 3]);
    const cipher = await encryptBlob(publicOnly!, bytes, "alice", "blob");
    await expect(decryptBlob(publicOnly!, cipher, "alice", "blob")).rejects.toThrow(/Unlock/);
    expect(await decryptBlob(restored.dek, cipher, "alice", "blob")).toEqual(bytes);
    expect(await keystore.uploadKey(passkey, "different-user")).toBeNull();
    const untrusted = {
      ...passkey,
      keystore: { ...passkey.keystore, backup: { ...passkey.keystore.backup!, publicKey: "changed" } },
    };
    expect(await keystore.uploadKey(untrusted, "alice")).toBeNull();
    memory.reset();
    expect(await keystore.uploadKey(passkey, "alice")).toBeNull();
  });
});

describe("required backup protection", () => {
  it("prepares a key in memory and only sends it after PIN setup with create-only semantics", async () => {
    const prepared = await keystore.prepareSetup();
    expect(api.putKeystore).not.toHaveBeenCalled();
    expect(prepared.state.etag).toBe("");
    await expect(keystore.enableBackupUploads(prepared.state, prepared.dek, "alice")).rejects.toThrow(
      /require a PIN or passkey/,
    );
    const protectedState = await keystore.setPin(prepared.state, prepared.dek, "123456", "alice");
    expect(api.putKeystore).toHaveBeenCalledExactlyOnceWith(JSON.stringify(protectedState.keystore), {
      ifNoneMatch: "*",
    });
    expect(protectedState.keystore).not.toHaveProperty("dek");
    expect(await keystore.unlockWithPin(protectedState, "123456", "alice")).toEqual(prepared.dek);
  });

  it("does not accept an empty or short PIN through the storage API", async () => {
    const prepared = await keystore.prepareSetup();
    for (const pin of ["", "123", "x".repeat(33)]) {
      await expect(keystore.setPin(prepared.state, prepared.dek, pin, "alice")).rejects.toThrow(/PIN/);
    }
    expect(api.putKeystore).not.toHaveBeenCalled();
  });
});
