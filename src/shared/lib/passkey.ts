/** WebAuthn PRF is used only for key wrapping; the proxy still authenticates users. */
import { type DEK, fromBase64, toBase64 } from "./crypto";

export interface PasskeyEnvelope {
  credentialId: string; // standard base64, like the other keystore fields
  rpId: string;
  salt: string;
  nonce: string;
  wrappedDek: string;
}

// Keep extension types local for TypeScript versions without PRF declarations.
type PrfInputs = AuthenticationExtensionsClientInputs & {
  prf: { eval?: { first: Uint8Array<ArrayBuffer> } };
};
type PrfOutputs = AuthenticationExtensionsClientOutputs & {
  prf?: { enabled?: boolean; results?: { first: unknown } };
};

export function supportsPasskeys(): boolean {
  return globalThis.isSecureContext === true && typeof PublicKeyCredential !== "undefined" && !!navigator.credentials;
}

function requireSupport(): void {
  if (!supportsPasskeys()) throw new Error("Passkeys require HTTPS (or localhost) and a supported browser.");
}

function randomBytes(size: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(size));
}

function publicKeyCredential(value: Credential | null): PublicKeyCredential {
  if (!value || value.type !== "public-key") throw new Error("Passkey request did not complete. Try again.");
  return value as PublicKeyCredential;
}

/** Normalize the extension boundary, including 1Password's reported plain-array results. */
function prfBytes(value: unknown): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (value instanceof ArrayBuffer && value.byteLength === 32) {
    bytes = new Uint8Array(value.slice(0));
  } else if (ArrayBuffer.isView(value) && value.byteLength === 32) {
    bytes = new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  } else if (
    Array.isArray(value) &&
    value.length === 32 &&
    Array.from(value).every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    bytes = new Uint8Array(value);
  } else {
    throw new Error(
      "The browser or passkey provider did not return a valid encryption secret (WebAuthn PRF). Try updating both, choose another provider, or use a PIN.",
    );
  }
  return bytes;
}

async function wrappingKey(credentialId: string, rpId: string, salt: string, userId: string): Promise<CryptoKey> {
  requireSupport();
  if (rpId !== location.hostname) throw new Error("This passkey belongs to a different site address.");
  const credential = publicKeyCredential(
    await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId,
        allowCredentials: [{ type: "public-key", id: fromBase64(credentialId) }],
        userVerification: "required",
        timeout: 60_000,
        extensions: { prf: { eval: { first: fromBase64(salt) } } } as PrfInputs,
      },
    }),
  );
  if (toBase64(new Uint8Array(credential.rawId)) !== credentialId) throw new Error("Unexpected passkey returned.");
  const result = prfBytes((credential.getClientExtensionResults() as PrfOutputs).prf?.results?.first);
  // Separate wrapping keys from other uses of the credential's PRF output.
  const material = await crypto.subtle.importKey("raw", result, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: fromBase64(salt),
      info: new TextEncoder().encode(`wingman:passkey:${userId}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(userId: string, kid: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`wingman:passkey:keystore:${userId}:${kid}`);
}

export async function createPasskeyEnvelope(dek: DEK, userId: string): Promise<PasskeyEnvelope> {
  requireSupport();
  const rpId = location.hostname;
  const salt = toBase64(randomBytes(32));
  const credential = publicKeyCredential(
    await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { id: rpId, name: "Wingman" },
        // A fresh handle prevents replacement enrollment from overwriting the working credential
        // before verification and the keystore CAS succeed. Identity comes from the proxy.
        user: { id: randomBytes(32), name: userId, displayName: "Wingman encrypted sync" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none",
        timeout: 60_000,
        extensions: { prf: { eval: { first: fromBase64(salt) } } } as PrfInputs,
      },
    }),
  );
  const credentialId = toBase64(new Uint8Array(credential.rawId));
  // Some providers omit the creation capability flag. Successful PRF evaluation
  // and repeatable unwrap below are the authority for enabling protection.
  // Always evaluate via get: some authenticators only enable PRF during create.
  const key = await wrappingKey(credentialId, rpId, salt, userId);
  const nonce = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad(userId, dek.kid) },
    key,
    dek.raw,
  );
  const envelope = {
    credentialId,
    rpId,
    salt,
    nonce: toBase64(nonce),
    wrappedDek: toBase64(new Uint8Array(ciphertext)),
  };
  // A second assertion verifies this credential returns a repeatable secret before replacing the keystore.
  const verified = await unlockPasskeyEnvelope(envelope, userId, dek.kid);
  if (!verified.raw.every((byte, index) => byte === dek.raw[index])) throw new Error("Passkey verification failed.");
  return envelope;
}

export async function unlockPasskeyEnvelope(envelope: PasskeyEnvelope, userId: string, kid: number): Promise<DEK> {
  const key = await wrappingKey(envelope.credentialId, envelope.rpId, envelope.salt, userId);
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.nonce), additionalData: aad(userId, kid) },
      key,
      fromBase64(envelope.wrappedDek),
    ),
  );
  if (raw.length !== 32) throw new Error("Invalid encryption key length.");
  return { raw, kid };
}
