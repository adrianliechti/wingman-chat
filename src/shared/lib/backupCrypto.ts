/** Hybrid backup encryption: public keys upload; private keys are needed to restore. */
export interface BackupKeys {
  publicKey: CryptoKey;
  privateKey?: CryptoKey;
}

const rsa = { name: "RSA-OAEP", hash: "SHA-256" };
const encoder = new TextEncoder();

export async function generateBackupKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ ...rsa, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function importBackupPublicKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", bytes, rsa, false, ["encrypt"]);
}

export async function importBackupPrivateKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", bytes, rsa, false, ["decrypt"]);
}

/** v3 || kid || wrapped-key-length(2) || wrapped key || nonce(12) || ciphertext/tag. */
export async function encryptBackup(
  keys: BackupKeys,
  kid: number,
  plaintext: Uint8Array,
  context: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`backup-v3:${kid}:${context}`);
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP", label: aad }, keys.publicKey, raw));
  raw.fill(0);
  const bytes = new Uint8Array(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, aes, bytes),
  );
  const out = new Uint8Array(4 + wrapped.length + 12 + ciphertext.length);
  out[0] = 3;
  out[1] = kid;
  new DataView(out.buffer).setUint16(2, wrapped.length);
  out.set(wrapped, 4);
  out.set(nonce, 4 + wrapped.length);
  out.set(ciphertext, 16 + wrapped.length);
  return out;
}

export async function decryptBackup(
  keys: BackupKeys | undefined,
  kid: number,
  bytes: Uint8Array<ArrayBuffer>,
  context: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!keys?.privateKey) throw new Error("Unlock with your PIN or passkey to restore server data.");
  if (bytes.length < 4 || bytes[0] !== 3 || bytes[1] !== kid) throw new Error("Invalid backup key or envelope.");
  const wrappedLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(2);
  if (wrappedLength !== 384 || bytes.length < 4 + wrappedLength + 12 + 16)
    throw new Error("Invalid backup envelope length.");
  const aad = encoder.encode(`backup-v3:${kid}:${context}`);
  const raw = new Uint8Array(
    await crypto.subtle.decrypt({ name: "RSA-OAEP", label: aad }, keys.privateKey, bytes.slice(4, 4 + wrappedLength)),
  );
  if (raw.length !== 32) throw new Error("Invalid backup content key.");
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  raw.fill(0);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(4 + wrappedLength, 16 + wrappedLength), additionalData: aad },
      aes,
      bytes.slice(16 + wrappedLength),
    ),
  );
}
