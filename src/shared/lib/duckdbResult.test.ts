import { describe, expect, it } from "vitest";
import { collectDuckDbResult, toJsonValue } from "./duckdbResult";

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

  it("flattens Arrow rows, vectors and structs", async () => {
    const reader = {
      schema: {
        fields: [
          { name: "id", type: "Int64" },
          { name: "tags", type: "List<Utf8>" },
          { name: "meta", type: "Struct" },
        ],
      },
      async *[Symbol.asyncIterator]() {
        yield [
          {
            toJSON: () => ({
              id: 7n,
              tags: { toArray: () => ["a", "b"] },
              meta: { toJSON: () => ({ n: 1n, when: null }) },
            }),
          },
        ];
      },
    };
    expect(await collectDuckDbResult(reader)).toEqual({
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

describe("streamed result budgets", () => {
  function reader(values: unknown[]) {
    let read = 0;
    let closed = false;
    return {
      schema: { fields: [{ name: "value", type: "Utf8" }] },
      get read() {
        return read;
      },
      get closed() {
        return closed;
      },
      async *[Symbol.asyncIterator]() {
        try {
          for (const value of values) {
            read++;
            yield [{ toJSON: () => ({ value }) }];
          }
        } finally {
          closed = true;
        }
      },
    };
  }

  it("stops consuming batches at the row limit", async () => {
    const source = reader([1, 2, 3, 4]);
    await expect(collectDuckDbResult(source, { rows: 2, bytes: 1024 })).rejects.toThrow("Use LIMIT");
    expect(source.read).toBe(3);
    expect(source.closed).toBe(true);
  });

  it("counts UTF-8 bytes and permits results exactly at the row limit", async () => {
    const values = ["é".repeat(30)];
    await expect(collectDuckDbResult(reader(values), { rows: 1, bytes: 90 })).rejects.toThrow("fewer columns");
    const result = await collectDuckDbResult(reader(values), { rows: 1, bytes: 120 });
    expect(result.rows).toEqual([{ value: values[0] }]);
  });
});
