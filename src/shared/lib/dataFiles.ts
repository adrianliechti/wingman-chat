/**
 * Tabular files the app reads through DuckDB by name. Shared by artifact kind
 * detection, the DuckDB workspace mount, and the data viewer.
 */

const DATA_EXTENSIONS = new Set(["csv", "tsv", "jsonl", "ndjson", "parquet", "arrow"]);

/** Whether DuckDB can scan the file by name; `.gz` is allowed on text formats. */
export function isDataFilePath(path: string): boolean {
  const name = path.toLowerCase().split("/").pop() ?? "";
  const stripped = name.endsWith(".gz") ? name.slice(0, -3) : name;
  const dot = stripped.lastIndexOf(".");
  return dot > 0 && DATA_EXTENSIONS.has(stripped.slice(dot + 1));
}

/** Files mounted by name for SQL: data files plus formats with their own viewer (xlsx, json). */
export function isMountablePath(path: string): boolean {
  return isDataFilePath(path) || /\.(xlsx|json)$/i.test(path);
}
