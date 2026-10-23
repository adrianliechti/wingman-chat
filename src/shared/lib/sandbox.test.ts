import { describe, expect, it } from "vitest";
import { normalizeArtifactPath } from "./sandbox";

describe("normalizeArtifactPath", () => {
  it("normalizes sandbox prefixes and dot segments", () => {
    expect(normalizeArtifactPath("/home/user/./reports//result.csv")).toBe("/reports/result.csv");
  });

  it("rejects parent traversal and null bytes", () => {
    expect(normalizeArtifactPath("/reports/../secret.txt")).toBeUndefined();
    expect(normalizeArtifactPath("/bad\0name.txt")).toBeUndefined();
  });
});
