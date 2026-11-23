import { describe, expect, it } from "vitest";
import {
  decryptBlob,
  decryptEvent,
  decryptFile,
  encryptBlob,
  encryptEvent,
  encryptFile,
  fromBase64,
  generateDEK,
  toBase64,
  toDeviceKey,
  unwrapDEKWithPin,
  wrapDEKWithPin,
} from "./crypto";
import { generateStoreKey } from "./test-support/storeKey";

describe("base64", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("event encryption", () => {
  it("round-trips a payload", async () => {
    const dek = await generateStoreKey();
    const payload = { id: "e1", body: [{ type: "tombstone" }] };
    const frame = await encryptEvent(dek, payload, "user1", "chat1", 7);
    expect(await decryptEvent(dek, frame, "user1", "chat1", 7)).toEqual(payload);
  });

  it("rejects a frame bound to different AAD context", async () => {
    const dek = await generateStoreKey();
    const frame = await encryptEvent(dek, { x: 1 }, "user1", "chat1", 7);
    await expect(decryptEvent(dek, frame, "user1", "chat1", 8)).rejects.toThrow();
    await expect(decryptEvent(dek, frame, "user1", "chat2", 7)).rejects.toThrow();
    await expect(decryptEvent(dek, frame, "user2", "chat1", 7)).rejects.toThrow();
  });

  it("rejects a frame encrypted with another DEK", async () => {
    const frame = await encryptEvent(await generateStoreKey(), { x: 1 }, "user1", "chat1", 1);
    await expect(decryptEvent(await generateStoreKey(), frame, "user1", "chat1", 1)).rejects.toThrow();
  });

  it("rejects truncated frames", async () => {
    const dek = await generateStoreKey();
    await expect(decryptEvent(dek, toBase64(new Uint8Array(20)), "user1", "chat1", 1)).rejects.toThrow(/too short/);
  });
});

describe("blob encryption", () => {
  it("round-trips data", async () => {
    const dek = await generateStoreKey();
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const cipher = await encryptBlob(dek, data, "user1", "blob1");
    expect(await decryptBlob(dek, cipher, "user1", "blob1")).toEqual(data);
  });

  it("rejects a blob bound to a different id", async () => {
    const dek = await generateStoreKey();
    const cipher = await encryptBlob(dek, new Uint8Array([1]), "user1", "blob1");
    await expect(decryptBlob(dek, cipher, "user1", "blob2")).rejects.toThrow();
  });
});

describe("file envelope", () => {
  it("round-trips header and bytes", async () => {
    const dek = await generateStoreKey();
    const bytes = new Uint8Array([10, 0, 10, 255, 10]); // embedded newlines must not confuse the header split
    const cipher = await encryptFile(dek, { path: "agents/a/AGENTS.md", mtime: 123 }, bytes, "user1", "f1");
    const out = await decryptFile<{ path: string; mtime: number }>(dek, cipher, "user1", "f1");
    expect(out.header).toEqual({ path: "agents/a/AGENTS.md", mtime: 123 });
    expect(out.bytes).toEqual(bytes);
  });

  it("rejects a file bound to a different id", async () => {
    const dek = await generateStoreKey();
    const cipher = await encryptFile(dek, { path: "p" }, new Uint8Array([1]), "user1", "f1");
    await expect(decryptFile(dek, cipher, "user1", "f2")).rejects.toThrow();
  });
});

describe("PIN wrapping", () => {
  it("wraps and unwraps the DEK", async () => {
    const dek = generateDEK();
    const wrapped = await wrapDEKWithPin(dek, "1234", "user1");
    const unwrapped = await unwrapDEKWithPin(wrapped, "1234", "user1");
    expect(toBase64(unwrapped.raw)).toBe(toBase64(dek.raw));
  });

  it("rejects a wrong PIN and a wrong user", async () => {
    const dek = generateDEK();
    const wrapped = await wrapDEKWithPin(dek, "1234", "user1");
    await expect(unwrapDEKWithPin(wrapped, "9999", "user1")).rejects.toThrow();
    await expect(unwrapDEKWithPin(wrapped, "1234", "user2")).rejects.toThrow();
  });

  it("uses Argon2id and rejects other KDFs", async () => {
    const dek = generateDEK();
    const wrapped = await wrapDEKWithPin(dek, "correct horse", "user1");
    expect(wrapped.kdf).toMatchObject({ name: "argon2id", m: 65536, t: 3, p: 1 });
    expect(toBase64((await unwrapDEKWithPin(wrapped, "correct horse", "user1")).raw)).toBe(toBase64(dek.raw));
    const pbkdf2 = { ...wrapped, kdf: { name: "pbkdf2-sha256", salt: wrapped.kdf.salt, iter: 600_000 } };
    await expect(unwrapDEKWithPin(pbkdf2 as never, "correct horse", "user1")).rejects.toThrow(/unsupported kdf/);
  });

  it("rejects hostile Argon2id parameters before deriving", async () => {
    const dek = generateDEK();
    const wrapped = await wrapDEKWithPin(dek, "1234", "user1");
    const huge = { ...wrapped, kdf: { ...wrapped.kdf, m: 4 * 1024 * 1024 } };
    await expect(unwrapDEKWithPin(huge, "1234", "user1")).rejects.toThrow(/unsupported/);
  });
});

describe("device keys", () => {
  it("decrypt without exposing the root key bytes", async () => {
    const dek = generateDEK();
    const device = await toDeviceKey(dek);
    expect(device.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", device.key)).rejects.toThrow();
    const frame = await encryptEvent(dek, { x: 7 }, "user1", "chat1", 1);
    expect(await decryptEvent(device, frame, "user1", "chat1", 1)).toEqual({ x: 7 });
    await expect(decryptEvent(device, frame, "user2", "chat1", 1)).rejects.toThrow();
  });
});
