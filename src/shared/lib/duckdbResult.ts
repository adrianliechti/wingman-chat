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

export interface ArrowLikeTable {
  schema: { fields: ArrowLikeField[] };
  toArray(): Array<{ toJSON(): Record<string, unknown> }>;
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

export function serializeArrowTable(table: ArrowLikeTable): DuckDbQueryResult {
  const columns = table.schema.fields.map((field) => ({ name: field.name, type: String(field.type) }));
  const rows = table.toArray().map((row) => {
    const raw = row.toJSON();
    const out: Record<string, unknown> = {};
    for (const column of columns) out[column.name] = toJsonValue(raw[column.name], column.type);
    return out;
  });
  return { columns, rows, rowCount: rows.length };
}
