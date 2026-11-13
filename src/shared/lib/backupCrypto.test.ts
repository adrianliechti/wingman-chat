import { beforeAll, describe, expect, it } from "vitest";
import { generateBackupKeys } from "./backupCrypto";
import {
  type DEK,
  type UploadKey,
  decryptBlob,
  decryptEvent,
  decryptFile,
  encryptBlob,
  encryptEvent,
  encryptFile,
  generateDEK,
} from "./crypto";

let unlocked: DEK;
let uploader: UploadKey;
beforeAll(async () => {
  const pair = await generateBackupKeys();
  unlocked = { ...(await generateDEK(9)), backup: { publicKey: pair.publicKey, privateKey: pair.privateKey } };
  uploader = { kid: 9, backup: { publicKey: pair.publicKey } };
});

describe("public-key upload encryption", () => {
  it("uploads events without a restore key, then decrypts only after unlocking", async () => {
    const frame = await encryptEvent(uploader, { body: "private" }, "alice", "chat", 3);
    expect(await decryptEvent(unlocked, frame, "alice", "chat", 3)).toEqual({ body: "private" });
    await expect(decryptEvent(uploader, frame, "alice", "chat", 3)).rejects.toThrow(/Unlock/);
    await expect(decryptEvent(unlocked, frame, "bob", "chat", 3)).rejects.toThrow();
    await expect(decryptEvent(unlocked, frame, "alice", "chat", 4)).rejects.toThrow();
  });

  it("uses independent randomized content keys for files and attachments", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const file = await encryptFile(uploader, { path: "agents/a.md" }, bytes, "alice", "file");
    const blob = await encryptBlob(uploader, bytes, "alice", "blob");
    expect(file[0]).toBe(3);
    expect(await encryptBlob(uploader, bytes, "alice", "blob")).not.toEqual(blob);
    expect(await decryptFile(unlocked, file, "alice", "file")).toEqual({ header: { path: "agents/a.md" }, bytes });
    expect(await decryptBlob(unlocked, blob, "alice", "blob")).toEqual(bytes);
    await expect(decryptFile(uploader, file, "alice", "file")).rejects.toThrow(/Unlock/);
    await expect(decryptBlob(uploader, blob, "alice", "blob")).rejects.toThrow(/Unlock/);
    blob[blob.length - 1] ^= 1;
    await expect(decryptBlob(unlocked, blob, "alice", "blob")).rejects.toThrow();
  });

  it("keeps old symmetric history decryptable only with the unlocked root", async () => {
    const root = { kid: unlocked.kid, raw: unlocked.raw };
    const old = await encryptEvent(root, { legacy: true }, "alice", "chat", 1);
    expect(await decryptEvent(unlocked, old, "alice", "chat", 1)).toEqual({ legacy: true });
    await expect(decryptEvent(uploader, old, "alice", "chat", 1)).rejects.toThrow(/Unlock/);
    const malformed = new Uint8Array([3, 9, 255, 255]);
    await expect(decryptBlob(unlocked, malformed, "alice", "blob")).rejects.toThrow(/length/);
  });
});
