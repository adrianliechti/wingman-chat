import { describe, expect, it } from "vitest";
import { dataUrlDecodedByteLength } from "./fileContent";

describe("data URL size preflight", () => {
  it("computes padded and unpadded decoded lengths without decoding", () => {
    expect(dataUrlDecodedByteLength("data:text/plain;base64,TQ==")).toBe(1);
    expect(dataUrlDecodedByteLength("data:text/plain;base64,TWE=")).toBe(2);
    expect(dataUrlDecodedByteLength("data:text/plain;base64,TWFu")).toBe(3);
    expect(dataUrlDecodedByteLength("data:text/plain;base64,TQ")).toBe(1);
  });

  it("rejects malformed base64 metadata", () => {
    expect(dataUrlDecodedByteLength("not-a-data-url")).toBeNull();
    expect(dataUrlDecodedByteLength("data:;base64,TQ==")).toBeNull();
    expect(dataUrlDecodedByteLength("data:text/plain;charset=utf-8;base64,TQ==")).toBeNull();
    expect(dataUrlDecodedByteLength("data:text/plain;base64,A")).toBeNull();
    expect(dataUrlDecodedByteLength("data:text/plain;base64,%%%=")).toBeNull();
    expect(dataUrlDecodedByteLength("data:text/plain;base64,T=Q=")).toBeNull();
  });
});
