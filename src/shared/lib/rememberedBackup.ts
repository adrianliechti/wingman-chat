import { type DEK, fromBase64, toBase64 } from "./crypto";
import type { KeystoreState } from "./keystore";

interface RememberedBackup {
  userId: string;
  protection: string;
  kid: number;
  root: string;
}

// Separate from OPFS so exported/restored ZIP files never transfer device trust.
// This is a local decryption secret, protected by access to the browser profile.
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

export async function rememberBackup(userId: string, state: KeystoreState, dek: DEK): Promise<void> {
  await record({ userId, protection: await protection(state), kid: dek.kid, root: toBase64(dek.raw) });
}

export async function forgetBackup(): Promise<void> {
  await record(null);
}

export async function loadRememberedBackup(userId: string, state: KeystoreState): Promise<DEK | null> {
  const saved = await record();
  if (!saved) return null;
  if (saved.userId === userId && saved.kid === state.keystore.kid && saved.protection === (await protection(state))) {
    try {
      const raw = fromBase64(saved.root);
      if (raw.length === 32) return { raw, kid: saved.kid };
    } catch {
      /* Invalid local data requires an explicit unlock. */
    }
  }
  await forgetBackup();
  return null;
}
