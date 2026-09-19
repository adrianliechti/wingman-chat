import { describe, expect, it } from "vitest";
import { isDataFilePath, isMountablePath } from "./dataFiles";

describe("data files", () => {
  it("recognises scanned tabular files, including compressed text", () => {
    for (const path of ["/data/flights.csv", "/x.tsv.gz", "/events.ndjson", "/rows.jsonl", "/big.parquet", "/t.arrow"]) {
      expect(isDataFilePath(path), path).toBe(true);
    }
    for (const path of ["/notes.md", "/config.json", "/store.sqlite", "/.gz", "/archive.gz", "/a.csvx"]) {
      expect(isDataFilePath(path), path).toBe(false);
    }
  });

  it("mounts data files and the formats with their own viewers", () => {
    expect(isMountablePath("/a.csv")).toBe(true);
    expect(isMountablePath("/a.xlsx")).toBe(true);
    expect(isMountablePath("/a.json")).toBe(true);
    expect(isMountablePath("/a.png")).toBe(false);
  });
});
