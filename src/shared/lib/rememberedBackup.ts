import { type DeviceKey, type RootKey, toBase64, toDeviceKey } from "./crypto";
import type { KeystoreState } from "./keystore";

interface RememberedBackup {
  userId: string;
  protection: string;
  kid: number;
  /** Non-extractable AES-GCM root key; scripts can use it but never read its bytes. */
  key: CryptoKey;
}

// Separate from OPFS so exported/restored ZIP files never transfer device trust.
// This is a local decryption capability, protected by access to the browser profile.
async function record(value?: RememberedBackup | null): Promise<RememberedBackup | undefined> {
  if (typeof indexedDB === "undefined") {
    if (value) throw new Error("This browser cannot remember backup access.");
    return undefined;
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("wingman-backup-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("keys", value === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("keys");
      const request =
        value === undefined
          ? store.get("device")
          : value === null
            ? store.delete("device")
            : store.put(value, "device");
      transaction.oncomplete = () => resolve(value === undefined ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Couldn't save device access."));
    });
  } finally {
    db.close();
  }
}

async function protection(state: KeystoreState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(state.keystore));
  return toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function rememberBackup(userId: string, state: KeystoreState, dek: RootKey): Promise<void> {
  const { key, kid } = await toDeviceKey(dek);
  await record({ userId, protection: await protection(state), kid, key });
}

export async function forgetBackup(): Promise<void> {
  await record(null);
}

export async function loadRememberedBackup(userId: string, state: KeystoreState): Promise<DeviceKey | null> {
  const saved = await record();
  if (!saved) return null;
  if (
    saved.userId === userId &&
    saved.kid === state.keystore.kid &&
    saved.protection === (await protection(state)) &&
    saved.key instanceof CryptoKey &&
    !saved.key.extractable &&
    saved.key.algorithm.name === "AES-GCM"
  ) {
    return { key: saved.key, kid: saved.kid };
  }
  await forgetBackup();
  return null;
}
