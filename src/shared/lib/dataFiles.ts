/**
 * Data files the app reads through DuckDB: tabular files it scans by name and
 * database files it attaches. Shared by artifact kind detection, the DuckDB
 * workspace mount, and the data viewer.
 */

export type DataFileFormat = "file" | "sqlite" | "duckdb";

const FORMATS: Record<string, DataFileFormat> = {
  csv: "file",
  tsv: "file",
  jsonl: "file",
  ndjson: "file",
  parquet: "file",
  arrow: "file",
  sqlite: "sqlite",
  sqlite3: "sqlite",
  db: "sqlite",
  duckdb: "duckdb",
};

/** How DuckDB reads a path, or null when it is not a data file. `.gz` is allowed on scanned text files. */
export function dataFileFormat(path: string): DataFileFormat | null {
  const name = path.toLowerCase().split("/").pop() ?? "";
  const compressed = name.endsWith(".gz");
  const stripped = compressed ? name.slice(0, -3) : name;
  const dot = stripped.lastIndexOf(".");
  if (dot <= 0) return null;
  const format = FORMATS[stripped.slice(dot + 1)] ?? null;
  return compressed && format !== "file" ? null : format;
}

export function isDataFilePath(path: string): boolean {
  return dataFileFormat(path) !== null;
}

/** Files mounted by name for SQL: data files plus formats with their own viewer (xlsx, json). */
export function isMountablePath(path: string): boolean {
  return isDataFilePath(path) || /\.(xlsx|json)$/i.test(path);
}
