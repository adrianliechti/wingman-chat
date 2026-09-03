import { describe, expect, it } from "vitest";
import { artifactLanguage, inferContentTypeFromPath } from "./fileTypes";
import { fileExtension } from "./utils";

describe("dot-aware file extensions", () => {
  it("requires a non-leading dot and a non-empty suffix", () => {
    expect(fileExtension("report.CSV")).toBe("csv");
    expect(fileExtension("/data/report.tsv")).toBe("tsv");
    expect(fileExtension("csv")).toBe("");
    expect(fileExtension("/data/.csv")).toBe("");
    expect(fileExtension("report.")).toBe("");
  });

  it("uses the same classifier for MIME and language inference", () => {
    expect(inferContentTypeFromPath("report.csv")).toBe("text/csv");
    expect(inferContentTypeFromPath("csv")).toBeUndefined();
    expect(inferContentTypeFromPath(".csv")).toBeUndefined();
    expect(artifactLanguage("script.ts")).toBe("ts");
    expect(artifactLanguage("ts")).toBe("");
    expect(artifactLanguage("Dockerfile")).toBe("dockerfile");
  });
});
