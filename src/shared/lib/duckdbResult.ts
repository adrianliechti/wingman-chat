/**
 * Turn an Arrow table from DuckDB into plain JSON the artifact page or the
 * interpreters can use without an Arrow library: BigInt becomes a number when
 * it fits, dates and timestamps become ISO strings, nested values are plain.
 */

export interface DuckDbColumn {
  name: string;
  type: string;
}

export interface DuckDbQueryResult {
  columns: DuckDbColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface ArrowLikeField {
  name: string;
  type: unknown;
}

const isTemporal = (type: string) => /^(Date|Timestamp|Time)\b/i.test(type);

export function toJsonValue(value: unknown, type = ""): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (typeof value === "number" && isTemporal(type)) return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    const record = value as { toArray?: () => unknown[]; toJSON?: () => unknown };
    if (typeof record.toArray === "function") return record.toArray().map((item) => toJsonValue(item));
    if (typeof record.toJSON === "function") return toJsonValue(record.toJSON());
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return value;
}

export const DUCKDB_RESULT_MAX_ROWS = 100_000;
export const DUCKDB_RESULT_MAX_BYTES = 16 * 1024 * 1024;

/** Bound the JSON copy before it is sent to an artifact or interpreter. */
export async function collectDuckDbResult(
  reader: AsyncIterable<Iterable<{ toJSON(): Record<string, unknown> }>> & { schema: { fields: ArrowLikeField[] } },
  limits = { rows: DUCKDB_RESULT_MAX_ROWS, bytes: DUCKDB_RESULT_MAX_BYTES },
): Promise<DuckDbQueryResult> {
  const columns = reader.schema.fields.map((field) => ({ name: field.name, type: String(field.type) }));
  const rows: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify(columns)).byteLength;
  for await (const batch of reader) {
    for (const row of batch) {
      if (rows.length >= limits.rows)
        throw new Error("SQL result is too large. Use LIMIT, pagination, or aggregation.");
      const raw = row.toJSON();
      const value = Object.fromEntries(
        columns.map((column) => [column.name, toJsonValue(raw[column.name], column.type)]),
      );
      bytes += encoder.encode(JSON.stringify(value)).byteLength;
      if (bytes > limits.bytes) throw new Error("SQL result is too large. Select fewer columns or rows.");
      rows.push(value);
    }
  }
  return { columns, rows, rowCount: rows.length };
}
