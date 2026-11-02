import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDEK, toBase64 } from "./crypto";
import { createPasskeyEnvelope, supportsPasskeys, unlockPasskeyEnvelope } from "./passkey";

const credentialId = new Uint8Array([1, 2, 3]);
const create = vi.fn();
const get = vi.fn();
let secret: Uint8Array<ArrayBuffer>;
function credential(prf: object, id = credentialId) {
  return { type: "public-key", rawId: id.buffer, getClientExtensionResults: () => ({ prf }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  secret = crypto.getRandomValues(new Uint8Array(32));
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("location", { hostname: "wingman.example" });
  vi.stubGlobal("navigator", { credentials: { create, get } });
  create.mockResolvedValue(credential({ enabled: true }));
  get.mockImplementation(async () => credential({ results: { first: secret.buffer } }));
});
afterEach(() => vi.unstubAllGlobals());

describe("passkey wrapping", () => {
  it("verifies repeatable PRF output, then unlocks the same DEK after serialization", async () => {
    const dek = await generateDEK(7);
    const envelope = await createPasskeyEnvelope(dek, "alice");
    expect(get).toHaveBeenCalledTimes(2);
    expect(envelope.wrappedDek).not.toContain(toBase64(dek.raw));
    expect(await unlockPasskeyEnvelope(JSON.parse(JSON.stringify(envelope)), "alice", 7)).toEqual(dek);
    expect(get.mock.calls[0][0].publicKey).toMatchObject({
      rpId: "wingman.example",
      userVerification: "required",
      allowCredentials: [{ type: "public-key", id: credentialId }],
    });
    expect(create.mock.calls[0][0].publicKey.authenticatorSelection.userVerification).toBe("required");
  });

  it.each(["plain array", "typed array", "DataView"])(
    "accepts %s PRF output with exact byte boundaries",
    async (format) => {
      const padded = new Uint8Array(40);
      padded.set(secret, 4);
      const result =
        format === "plain array"
          ? Array.from(secret)
          : format === "typed array"
            ? padded.subarray(4, 36)
            : new DataView(padded.buffer, 4, 32);
      const dek = await generateDEK();
      const envelope = await createPasskeyEnvelope(dek, "alice");
      get.mockResolvedValue(credential({ results: { first: result } }));
      expect(await unlockPasskeyEnvelope(envelope, "alice", dek.kid)).toEqual(dek);
      const alternateEnvelope = await createPasskeyEnvelope(dek, "alice");
      get.mockResolvedValue(credential({ results: { first: secret.buffer } }));
      expect(await unlockPasskeyEnvelope(alternateEnvelope, "alice", dek.kid)).toEqual(dek);
    },
  );

  it("uses verified PRF results when a provider omits its creation capability flag", async () => {
    create.mockResolvedValue(credential({}));
    const dek = await generateDEK();
    const envelope = await createPasskeyEnvelope(dek, "alice");
    expect(await unlockPasskeyEnvelope(envelope, "alice", dek.kid)).toEqual(dek);
    expect(create.mock.calls[0][0].publicKey.extensions.prf.eval.first).toHaveLength(32);
  });

  it.each([
    undefined,
    null,
    [],
    new Uint8Array(31),
    new Uint8Array(33),
    Array(32),
    Array(32).fill(-1),
    Array(32).fill(256),
    Array(32).fill(0.5),
    Array(32).fill("0"),
    Array(32).fill(NaN),
    { length: 32 },
  ])("rejects malformed PRF output without coercing it into a key: %j", async (result) => {
    get.mockResolvedValue(credential({ results: { first: result } }));
    await expect(createPasskeyEnvelope(await generateDEK(), "alice")).rejects.toThrow(/PRF/);
  });

  it("rejects another user's context, key id, PRF secret, or tampered ciphertext", async () => {
    const envelope = await createPasskeyEnvelope(await generateDEK(2), "alice");
    await expect(unlockPasskeyEnvelope(envelope, "bob", 2)).rejects.toThrow();
    await expect(unlockPasskeyEnvelope(envelope, "alice", 3)).rejects.toThrow();
    await expect(
      unlockPasskeyEnvelope({ ...envelope, wrappedDek: toBase64(new Uint8Array(48)) }, "alice", 2),
    ).rejects.toThrow();
    secret = crypto.getRandomValues(new Uint8Array(32));
    await expect(unlockPasskeyEnvelope(envelope, "alice", 2)).rejects.toThrow();
  });

  it("refuses enrollment when the provider cannot evaluate PRF", async () => {
    get.mockResolvedValue(credential({}));
    await expect(createPasskeyEnvelope(await generateDEK(), "alice")).rejects.toThrow(/PRF/);
    create.mockResolvedValue(credential({ enabled: false }));
    await expect(createPasskeyEnvelope(await generateDEK(), "alice")).rejects.toThrow(/PRF/);
  });

  it("does not finish enrollment when the verification secret changes", async () => {
    get
      .mockResolvedValueOnce(credential({ results: { first: secret.buffer } }))
      .mockResolvedValueOnce(credential({ results: { first: new Uint8Array(32).buffer } }));
    await expect(createPasskeyEnvelope(await generateDEK(), "alice")).rejects.toThrow();
  });

  it("handles cancellation and rejects an unexpected credential", async () => {
    create.mockResolvedValueOnce(null);
    await expect(createPasskeyEnvelope(await generateDEK(), "alice")).rejects.toThrow(/did not complete/);
    get.mockResolvedValue(credential({ results: { first: secret.buffer } }, new Uint8Array([4])));
    await expect(createPasskeyEnvelope(await generateDEK(), "alice")).rejects.toThrow(/Unexpected passkey/);
  });

  it("rejects unsupported environments and a different site before requesting a secret", async () => {
    const envelope = await createPasskeyEnvelope(await generateDEK(), "alice");
    get.mockClear();
    vi.stubGlobal("location", { hostname: "different.example" });
    await expect(unlockPasskeyEnvelope(envelope, "alice", 1)).rejects.toThrow(/different site/);
    expect(get).not.toHaveBeenCalled();
    vi.stubGlobal("isSecureContext", false);
    expect(supportsPasskeys()).toBe(false);
    await expect(createPasskeyEnvelope(await generateDEK(), "alice")).rejects.toThrow(/HTTPS/);
  });
});
