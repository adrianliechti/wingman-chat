import { describe, expect, it } from "vitest";
import { dataFileFormat, isMountablePath } from "./dataFiles";

describe("data files", () => {
  it("classifies scanned files, databases, and compressed text", () => {
    expect(dataFileFormat("/data/flights.csv")).toBe("file");
    expect(dataFileFormat("/x.tsv.gz")).toBe("file");
    expect(dataFileFormat("/events.ndjson")).toBe("file");
    expect(dataFileFormat("/big.parquet")).toBe("file");
    expect(dataFileFormat("/store.sqlite")).toBe("sqlite");
    expect(dataFileFormat("/app.db")).toBe("sqlite");
    expect(dataFileFormat("/warehouse.duckdb")).toBe("duckdb");
    expect(dataFileFormat("/store.sqlite.gz")).toBeNull();
    expect(dataFileFormat("/notes.md")).toBeNull();
    expect(dataFileFormat("/config.json")).toBeNull();
    expect(dataFileFormat("/.gz")).toBeNull();
  });

  it("mounts data files and the formats with their own viewers", () => {
    expect(isMountablePath("/a.csv")).toBe(true);
    expect(isMountablePath("/a.xlsx")).toBe(true);
    expect(isMountablePath("/a.json")).toBe(true);
    expect(isMountablePath("/a.png")).toBe(false);
  });
});
