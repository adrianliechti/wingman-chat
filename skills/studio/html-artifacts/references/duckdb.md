# Workspace SQL in HTML

Feature-detect `window.wingman?.capabilities.duckdb`. Workspace DuckDB runs locally in the preview and is unavailable in downloaded pages.

- `await w.duckdb.files()` → mounted file names.
- `await w.duckdb.query(sql, params?)` → result on the document's default connection.
- `const conn = await w.duckdb.connect()`: dedicated connection with `await conn.query(sql, params?)` and `await conn.close()`.
- Result: `{ columns: [{ name, type }], rows: [{ ... }], rowCount }`.

Query CSV, TSV, JSON, JSONL/NDJSON, Parquet, XLSX and .gz text using workspace paths without the leading slash, e.g. `'data/sales.csv'`. Bare filenames also work when unique. Use `files()` to discover mounted names. The excel, fts and icu extensions load on demand; XLSX uses `read_xlsx('report.xlsx', sheet = 'Sheet1')`.

SQL reads committed workspace files; unsaved interpreter-run files are not visible. File commits become available to subsequent page queries. SQL tables/connections last for this HTML document, until navigation/close. SQL COPY does not create workspace artifacts; use the SDK files methods for saved output.

## Query example

Assume an existing `data/sales.csv` with region and amount columns; validate the actual schema first. Parameters bind values, not identifiers. Choose identifiers/paths from inspected schema, never raw user input.

```javascript
const w = window.wingman;
if (!w?.capabilities.duckdb) throw new Error("Workspace SQL requires the preview.");
const conn = await w.duckdb.connect();
try {
  const result = await conn.query(
    "SELECT region, SUM(amount) AS total FROM 'data/sales.csv' WHERE amount >= ? GROUP BY region ORDER BY total DESC",
    [0],
  );
  // result.rows is an array of objects, e.g. { region, total }.
  // Update charts, metrics and tables from a consistent filtered population.
} finally {
  await conn.close();
}
```

Catch errors in the page UI. Use one shared connection/update path where appropriate; do not create a new connection for every trivial refresh. Guard against stale responses replacing newer filter results.

Queries are capped at 100,000 result rows / 16 MiB, 256 MB memory and a two-minute timeout. Aggregate, LIMIT or paginate before reaching limits. Prepare heavy transformations in Python and save Parquet for runtime queries. Python's local `import duckdb` is a separate engine with separate state; it can see same-run files and write artifacts.

For a required standalone export, embed the necessary prepared data and implement the needed filtering with native browser code. Do not imply the workspace SQL service survives export.
