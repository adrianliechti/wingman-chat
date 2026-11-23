import { type DEK, generateDEK } from "../crypto";

/** An unlocked root key, as after PIN or passkey unlock. */
export async function generateStoreKey(): Promise<DEK> {
  return generateDEK();
}
