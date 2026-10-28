import { Deflate, Inflate, type DeflateOptions } from "pako";

export { constants } from "pako";

interface Options {
  level?: DeflateOptions["level"];
  maxOutputLength?: number;
}

/** The synchronous gzip subset used by just-bash, with its output limit enforced while decoding. */
function run(codec: Deflate | Inflate, input: Uint8Array, maxOutputLength = 0x7fffffff): Uint8Array {
  if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength < 1) throw new RangeError("Invalid output limit");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let ended = false;
  codec.onData = (chunk) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (bytes.length > maxOutputLength - size) throw new RangeError(`Output exceeds ${maxOutputLength} bytes`);
    chunks.push(bytes);
    size += bytes.length;
  };
  const onEnd = codec.onEnd.bind(codec);
  codec.onEnd = (status) => {
    ended = true;
    onEnd(status);
  };
  codec.push(input, true);
  if (codec.err) throw new Error(codec.msg || "Invalid gzip data");
  if (!ended) throw new Error("Unexpected end of gzip data");
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function gzipSync(input: Uint8Array, options: Options = {}): Uint8Array {
  return run(
    new Deflate({ gzip: true, level: options.level ?? -1, chunkSize: 16_384 }),
    input,
    options.maxOutputLength,
  );
}

export function gunzipSync(input: Uint8Array, options: Options = {}): Uint8Array {
  return run(new Inflate({ windowBits: 31, chunkSize: 16_384 }), input, options.maxOutputLength);
}
