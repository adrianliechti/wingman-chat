import { formatBytes } from "./utils";

export class ResponseSizeLimitError extends Error {
  readonly label: string;
  readonly limit: number;
  readonly observed: number;

  constructor(label: string, limit: number, observed: number) {
    super(`${label} is over the ${formatBytes(limit)} limit`);
    this.name = "ResponseSizeLimitError";
    this.label = label;
    this.limit = limit;
    this.observed = observed;
  }
}

function assertValidLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }
}

export function assertByteLengthWithinLimit(observed: number, maxBytes: number, label = "File"): void {
  assertValidLimit(maxBytes);
  if (!Number.isSafeInteger(observed) || observed < 0 || observed > maxBytes) {
    throw new ResponseSizeLimitError(label, maxBytes, observed);
  }
}

/**
 * Materialize a response body while enforcing a hard ceiling on the bytes the
 * Fetch API exposes. Content-Length is only an early hint: compressed response
 * lengths describe the transport representation, and any declaration can be
 * absent or wrong, so streamed bytes remain authoritative.
 */
export async function readResponseBlobWithLimit(response: Response, maxBytes: number, label = "File"): Promise<Blob> {
  assertValidLimit(maxBytes);

  const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  const rawContentLength = response.headers.get("content-length")?.trim();
  if (
    (!contentEncoding || contentEncoding === "identity") &&
    rawContentLength !== undefined &&
    /^\d+$/.test(rawContentLength)
  ) {
    const declaredBytes = Number(rawContentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResponseSizeLimitError(label, maxBytes, declaredBytes);
    }
  }

  const type = response.headers.get("content-type") ?? "";
  if (!response.body) return new Blob([], { type });

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (value.byteLength > maxBytes - byteLength) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseSizeLimitError(label, maxBytes, byteLength + value.byteLength);
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, { type });
}
