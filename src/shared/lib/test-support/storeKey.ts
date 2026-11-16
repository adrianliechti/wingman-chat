import { generateBackupKeys } from "../backupCrypto";
import { type DEK, generateDEK } from "../crypto";

/** An unlocked root key with its own backup key pair, as after enableBackupUploads. */
export async function generateStoreKey(kid = 1): Promise<DEK> {
  const { publicKey, privateKey } = await generateBackupKeys();
  return { ...(await generateDEK(kid)), backup: { publicKey, privateKey } };
}
