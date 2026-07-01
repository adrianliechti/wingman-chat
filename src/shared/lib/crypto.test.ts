import { describe, expect, it } from "vitest";
import {
  decryptBlob,
  decryptEvent,
  encryptBlob,
  encryptEvent,
  fromBase64,
  generateDEK,
  hashFrame,
  toBase64,
  unwrapDEKWithPin,
  wrapDEKWithPin,
  ZERO_HASH,
} from "./crypto";

describe("base64", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("ZERO_HASH is 32 zero bytes", () => {
    expect(fromBase64(ZERO_HASH)).toEqual(new Uint8Array(32));
  });
});

describe("event encryption", () => {
  it("round-trips a payload", async () => {
    const dek = await generateDEK();
    const payload = { id: "e1", body: [{ type: "tombstone" }] };
    const frame = await encryptEvent(dek, payload, "user1", "chat1", 7);
    expect(await decryptEvent(dek, frame, "user1", "chat1", 7)).toEqual(payload);
  });

  it("rejects a frame bound to different AAD context", async () => {
    const dek = await generateDEK();
    const frame = await encryptEvent(dek, { x: 1 }, "user1", "chat1", 7);
    await expect(decryptEvent(dek, frame, "user1", "chat1", 8)).rejects.toThrow();
    await expect(decryptEvent(dek, frame, "user1", "chat2", 7)).rejects.toThrow();
    await expect(decryptEvent(dek, frame, "user2", "chat1", 7)).rejects.toThrow();
  });

  it("rejects a frame encrypted with another DEK", async () => {
    const frame = await encryptEvent(await generateDEK(), { x: 1 }, "user1", "chat1", 1);
    await expect(decryptEvent(await generateDEK(), frame, "user1", "chat1", 1)).rejects.toThrow();
  });
});

describe("blob encryption", () => {
  it("round-trips data", async () => {
    const dek = await generateDEK();
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const cipher = await encryptBlob(dek, data, "user1", "blob1");
    expect(await decryptBlob(dek, cipher, "user1", "blob1")).toEqual(data);
  });

  it("rejects a blob bound to a different id", async () => {
    const dek = await generateDEK();
    const cipher = await encryptBlob(dek, new Uint8Array([1]), "user1", "blob1");
    await expect(decryptBlob(dek, cipher, "user1", "blob2")).rejects.toThrow();
  });
});

describe("PIN wrapping", () => {
  it("wraps and unwraps the DEK", async () => {
    const dek = await generateDEK();
    const wrapped = await wrapDEKWithPin(dek, "1234", "user1");
    const unwrapped = await unwrapDEKWithPin(wrapped, "1234", "user1");
    expect(toBase64(unwrapped.raw)).toBe(toBase64(dek.raw));
  });

  it("rejects a wrong PIN and a wrong user", async () => {
    const dek = await generateDEK();
    const wrapped = await wrapDEKWithPin(dek, "1234", "user1");
    await expect(unwrapDEKWithPin(wrapped, "9999", "user1")).rejects.toThrow();
    await expect(unwrapDEKWithPin(wrapped, "1234", "user2")).rejects.toThrow();
  });
});

describe("hashFrame", () => {
  it("is deterministic and content-sensitive", async () => {
    const a = toBase64(new Uint8Array([1, 2, 3]));
    const b = toBase64(new Uint8Array([1, 2, 4]));
    expect(await hashFrame(a)).toBe(await hashFrame(a));
    expect(await hashFrame(a)).not.toBe(await hashFrame(b));
  });
});
