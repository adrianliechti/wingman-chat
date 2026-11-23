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
  it("reports an incorrect PIN without writing protection changes", async () => {
    const prepared = keystore.prepareSetup();
    const pin = await keystore.setPin(prepared.state, prepared.dek, "12345678");
    vi.mocked(api.putKeystore).mockClear();

    await expect(keystore.unlockWithPin(pin, "wrong-pin")).rejects.toThrow("Incorrect PIN. Please try again.");
    expect(api.putKeystore).not.toHaveBeenCalled();
    expect(await keystore.unlockWithPin(pin, "12345678")).toEqual(prepared.dek);
  });

  it("adds and updates both methods without changing the encryption key or losing either method", async () => {
    const dek = generateDEK();
    const initial: keystore.KeystoreState = {
      etag: "initial-etag",
      keystore: { accountId: "alice", generation: "g", pinProtected: false },
    };
    const passkey = await keystore.setPasskey(initial, dek);
    expect(keystore.isProtected(passkey.keystore)).toBe(true);
    expect(keystore.isPasskeyProtected(passkey.keystore)).toBe(true);
    expect(api.putKeystore).toHaveBeenCalledWith(JSON.stringify(passkey.keystore), {
      ifMatch: "initial-etag",
    });
    expect(JSON.stringify(passkey.keystore)).not.toContain(toBase64(dek.raw));
    await expect(keystore.unlockWithPin(passkey, "")).rejects.toThrow(/passkey/);
    expect(await keystore.unlockWithPasskey(passkey)).toEqual(dek);
    const pin = await keystore.setPin(passkey, dek, "12345678");
    expect(keystore.isPasskeyProtected(pin.keystore)).toBe(true);
    expect(pin.keystore).toMatchObject({ pinProtected: true, passkeyProtected: true });
    expect(pin.keystore).not.toHaveProperty("dek");
    expect(await keystore.unlockWithPin(pin, "12345678")).toEqual(dek);
    expect(await keystore.unlockWithPasskey(pin)).toEqual(dek);
    const again = await keystore.setPasskey(pin, dek);
    expect(await keystore.unlockWithPasskey(again)).toEqual(dek);
    expect(await keystore.unlockWithPin(again, "12345678")).toEqual(dek);
    const unlocked = await keystore.unlockWithPin(again, "12345678");
    const changed = await keystore.setPin(again, unlocked, "98765432");
    expect(await keystore.unlockWithPasskey(changed)).toEqual(dek);
    expect(await keystore.unlockWithPin(changed, "98765432")).toEqual(dek);
    await expect(keystore.unlockWithPin(changed, "12345678")).rejects.toThrow();
  });

  it("preserves a PIN-only backup when adding or replacing a passkey fails", async () => {
    const prepared = keystore.prepareSetup();
    const pin = await keystore.setPin(prepared.state, prepared.dek, "12345678");
    const original = JSON.stringify(pin);
    vi.mocked(api.putKeystore).mockClear();
    get.mockRejectedValue(new DOMException("Cancelled", "NotAllowedError"));
    await expect(keystore.setPasskey(pin, prepared.dek)).rejects.toThrow("Cancelled");
    expect(api.putKeystore).not.toHaveBeenCalled();
    expect(JSON.stringify(pin)).toBe(original);
    expect(await keystore.unlockWithPin(pin, "12345678")).toEqual(prepared.dek);
  });

  it("does not upload anything when enrollment is cancelled or PRF is unsupported", async () => {
    const dek = generateDEK();
    const initial: keystore.KeystoreState = {
      etag: "initial",
      keystore: { accountId: "alice", generation: "g", pinProtected: false },
    };
    create.mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
    await expect(keystore.setPasskey(initial, dek)).rejects.toThrow();
    get.mockResolvedValue(null);
    await expect(keystore.setPasskey(initial, dek)).rejects.toThrow();
    expect(api.putKeystore).not.toHaveBeenCalled();
  });

  it("propagates CAS conflicts without replacing the current protected state", async () => {
    const dek = generateDEK();
    const initial: keystore.KeystoreState = {
      etag: "initial",
      keystore: { accountId: "alice", generation: "g", pinProtected: false },
    };
    await keystore.setPasskey(initial, dek);
    vi.mocked(api.putKeystore).mockClear();
    vi.mocked(api.putKeystore).mockRejectedValueOnce(new Error("Keystore changed on another device"));
    await expect(keystore.setPasskey(initial, dek)).rejects.toThrow(/another device/);
    expect(initial.etag).toBe("initial");
  });
});

describe("required backup protection", () => {
  it("prepares a key in memory and only sends it after PIN setup with create-only semantics", async () => {
    const prepared = keystore.prepareSetup();
    expect(api.putKeystore).not.toHaveBeenCalled();
    expect(prepared.state.etag).toBe("");
    const protectedState = await keystore.setPin(prepared.state, prepared.dek, "12345678");
    expect(api.putKeystore).toHaveBeenCalledExactlyOnceWith(JSON.stringify(protectedState.keystore), {
      ifNoneMatch: "*",
    });
    expect(protectedState.keystore).not.toHaveProperty("dek");
    expect(await keystore.unlockWithPin(protectedState, "12345678")).toEqual(prepared.dek);
  });

  it("does not accept an empty or short PIN through the storage API", async () => {
    const prepared = keystore.prepareSetup();
    for (const pin of ["", "123", "1234567", "x".repeat(33)]) {
      await expect(keystore.setPin(prepared.state, prepared.dek, pin)).rejects.toThrow(/PIN/);
    }
    expect(api.putKeystore).not.toHaveBeenCalled();
  });
});

describe("backup account ID", () => {
  it("binds the key to random per-backup IDs that protection changes keep", async () => {
    const prepared = keystore.prepareSetup();
    const { accountId, generation } = prepared.state.keystore;
    expect(accountId).toMatch(/^[0-9a-f]{32}$/);
    expect(keystore.prepareSetup().state.keystore.accountId).not.toBe(accountId);
    expect(keystore.prepareSetup().state.keystore.generation).not.toBe(generation);
    const pin = await keystore.setPin(prepared.state, prepared.dek, "12345678");
    const both = await keystore.setPasskey(pin, prepared.dek);
    expect(both.keystore).toMatchObject({ accountId, generation });
    expect(await keystore.unlockWithPin(both, "12345678")).toEqual(prepared.dek);
    expect(await keystore.unlockWithPasskey(both)).toEqual(prepared.dek);
    const moved = { ...both, keystore: { ...both.keystore, accountId: "0".repeat(32) } };
    await expect(keystore.unlockWithPin(moved, "12345678")).rejects.toThrow();
    await expect(keystore.unlockWithPasskey(moved)).rejects.toThrow();
  });
});
