import { describe, expect, it } from "vitest";
import { mountNames } from "./duckdbWorkspace";

describe("mountNames", () => {
  it("mounts every file under its path and unique files under their bare name too", () => {
    expect(mountNames(["/flights.csv", "/data/sales.csv", "/data/sales.parquet"])).toEqual(
      new Map([
        ["/flights.csv", ["flights.csv"]],
        ["/data/sales.csv", ["data/sales.csv", "sales.csv"]],
        ["/data/sales.parquet", ["data/sales.parquet", "sales.parquet"]],
      ]),
    );
  });

  it("does not alias a bare name shared by two folders", () => {
    expect(mountNames(["/a/x.csv", "/b/x.csv"])).toEqual(
      new Map([
        ["/a/x.csv", ["a/x.csv"]],
        ["/b/x.csv", ["b/x.csv"]],
      ]),
    );
  });
});
