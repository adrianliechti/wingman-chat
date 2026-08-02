import { describe, expect, it } from "vitest";
import {
  BoundedOutput,
  CodeExecutionLimitError,
  resolveCodeExecutionLimits,
  validateArtifactFiles,
} from "./executionLimits";

describe("code execution limits", () => {
  it("truncates output on a UTF-8 boundary", () => {
    const output = new BoundedOutput(64);
    output.append(`abc🪽${"tail".repeat(40)}`);
    const value = output.value();

    expect(new TextEncoder().encode(value).byteLength).toBeLessThanOrEqual(64);
    expect(value).toContain("truncated at 64 bytes");
    expect(value).not.toContain("�");
  });

  it("rejects too many, oversized, and over-total files", () => {
    expect(() =>
      validateArtifactFiles(
        { "/a": { content: "a" }, "/b": { content: "b" } },
        resolveCodeExecutionLimits({ maxFiles: 1 }),
      ),
    ).toThrow(CodeExecutionLimitError);
    expect(() =>
      validateArtifactFiles({ "/a": { content: "abcd" } }, resolveCodeExecutionLimits({ maxFileBytes: 3 })),
    ).toThrow(/per-file limit/);
    expect(() =>
      validateArtifactFiles(
        { "/a": { content: "abc" }, "/b": { content: "def" } },
        resolveCodeExecutionLimits({ maxTotalFileBytes: 5 }),
      ),
    ).toThrow(/total limit/);
  });

  it("rejects invalid limit overrides", () => {
    expect(() => resolveCodeExecutionLimits({ maxFiles: 0 })).toThrow(CodeExecutionLimitError);
  });

  it("rejects traversal and duplicate path aliases", () => {
    const limits = resolveCodeExecutionLimits();
    expect(() => validateArtifactFiles({ "../escape": { content: "x" } }, limits)).toThrow(/invalid path/);
    expect(() =>
      validateArtifactFiles({ "same.txt": { content: "x" }, "/same.txt": { content: "y" } }, limits),
    ).toThrow(/duplicate path aliases/);
  });
});
