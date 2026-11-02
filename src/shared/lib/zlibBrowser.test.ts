import { gzipSync as nodeGzip, gunzipSync as nodeGunzip } from "zlib";
import { describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "./zlibBrowser";

describe("browser gzip compatibility", () => {
  it("interoperates with Node gzip and preserves binary bytes at every compression level", () => {
    const bytes = Uint8Array.from({ length: 65_537 }, (_, i) => i % 256);
    for (const level of [-1, 0, 1, 9] as const) {
      expect(gunzipSync(nodeGzip(bytes, { level }))).toEqual(bytes);
      expect(new Uint8Array(nodeGunzip(gzipSync(bytes, { level })))).toEqual(bytes);
    }
  });

  it("decodes concatenated gzip members", () => {
    const a = nodeGzip("first");
    const b = nodeGzip("second");
    expect(new TextDecoder().decode(gunzipSync(new Uint8Array([...a, ...b])))).toBe("firstsecond");
  });

  it("rejects corrupt or truncated streams", () => {
    const bytes = nodeGzip("content");
    expect(() => gunzipSync(bytes.subarray(0, -4))).toThrow();
    bytes[bytes.length - 8] ^= 1;
    expect(() => gunzipSync(bytes)).toThrow();
  });

  it("enforces limits during compression and decompression, including misleading trailer sizes", () => {
    const packed = nodeGzip(new Uint8Array(1_000_000));
    // Do not trust the advertised size: a decoder must bound emitted chunks too.
    packed.fill(0, packed.length - 4);
    expect(() => gunzipSync(packed, { maxOutputLength: 1024 })).toThrow("Output exceeds 1024 bytes");
    expect(() => gzipSync(new Uint8Array(100), { maxOutputLength: 10 })).toThrow("Output exceeds 10 bytes");
    expect(gunzipSync(nodeGzip("ok"), { maxOutputLength: 2 })).toEqual(new TextEncoder().encode("ok"));
  });
});
