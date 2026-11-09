import { argon2id } from "hash-wasm";

export interface Argon2Cost {
  /** Memory in KiB. */
  m: number;
  t: number;
  p: number;
}

export async function deriveArgon2id(
  password: Uint8Array,
  salt: Uint8Array,
  cost: Argon2Cost,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = await argon2id({
    password,
    salt,
    memorySize: cost.m,
    iterations: cost.t,
    parallelism: cost.p,
    hashLength: 32,
    outputType: "binary",
  });
  return new Uint8Array(out);
}
