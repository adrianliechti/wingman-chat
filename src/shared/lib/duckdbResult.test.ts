import { describe, expect, it } from "vitest";
import { serializeArrowTable, toJsonValue } from "./duckdbResult";

describe("duckdb result serialisation", () => {
  it("keeps safe integers as numbers and larger ones as strings", () => {
    expect(toJsonValue(42n)).toBe(42);
    expect(toJsonValue(2n ** 60n)).toBe((2n ** 60n).toString());
  });

  it("renders temporal values as ISO strings and bytes as arrays", () => {
    expect(toJsonValue(new Date(Date.UTC(2026, 0, 2)))).toBe("2026-01-02T00:00:00.000Z");
    expect(toJsonValue(Date.UTC(2026, 0, 2), "Timestamp<MICROSECOND>")).toBe("2026-01-02T00:00:00.000Z");
    expect(toJsonValue(1.5, "Float64")).toBe(1.5);
    expect(toJsonValue(new Uint8Array([1, 2]))).toEqual([1, 2]);
  });

  it("flattens Arrow rows, vectors and structs", () => {
    const table = {
      schema: {
        fields: [
          { name: "id", type: "Int64" },
          { name: "tags", type: "List<Utf8>" },
          { name: "meta", type: "Struct" },
        ],
      },
      toArray: () => [
        {
          toJSON: () => ({
            id: 7n,
            tags: { toArray: () => ["a", "b"] },
            meta: { toJSON: () => ({ n: 1n, when: null }) },
          }),
        },
      ],
    };
    expect(serializeArrowTable(table)).toEqual({
      columns: [
        { name: "id", type: "Int64" },
        { name: "tags", type: "List<Utf8>" },
        { name: "meta", type: "Struct" },
      ],
      rows: [{ id: 7, tags: ["a", "b"], meta: { n: 1, when: null } }],
      rowCount: 1,
    });
  });
});
