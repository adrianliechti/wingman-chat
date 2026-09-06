export interface Embedding {
  vector: number[];
  /** Model identity reported by the backend, including when it selects a default. */
  model: string;
}

/** Vectors must remain usable after persistence as Float32 values. */
export function validateEmbeddingVector(vector: unknown): asserts vector is number[] {
  if (!Array.isArray(vector) || !vector.length) {
    throw new Error("The embedding service returned an invalid vector");
  }
  let nonZero = false;
  for (const value of vector) {
    if (typeof value !== "number" || !Number.isFinite(Math.fround(value)))
      throw new Error("The embedding service returned an invalid vector");
    nonZero ||= Math.fround(value) !== 0;
  }
  if (!nonZero) throw new Error("The embedding service returned an invalid vector");
}
