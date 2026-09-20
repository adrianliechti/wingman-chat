import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/interpreter.html");
  await page.waitForFunction(() => Boolean(window.interpreterE2E));
});

test("DuckDB and Arrow files pass between interpreters and the preview SQL host", async ({ page }) => {
  const chatId = `data-${crypto.randomUUID()}`;
  const python = await page.evaluate(
    (id) =>
      window.interpreterE2E.executeWorkspace(
        "python",
        id,
        `import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path
Path("data").mkdir(exist_ok=True)
table = pa.table({"id": pa.array([9007199254740993, None], type=pa.int64()), "amount": [4.5, 2.5]})
# Deliberately leave this connection open: the runtime must close it before sync.
con = duckdb.connect("data/analysis.duckdb")
assert con.sql("SELECT current_setting('memory_limit')").fetchone()[0] == '244.1 MiB'
con.register("input_data", table)
con.register("frame", pd.DataFrame({"multiplier": [2]}))
con.execute("CREATE TABLE saved AS SELECT id, amount * multiplier AS amount FROM input_data CROSS JOIN frame")
con.execute("COPY saved TO 'data/analysis.parquet' (FORMAT PARQUET)")
assert con.sql("SELECT sum(amount) AS total FROM saved").df()["total"].iloc[0] == 14.0
result = con.sql("SELECT * FROM input_data").to_arrow_table()
assert isinstance(result, pa.Table)
with pa.ipc.new_file("data/python.arrow", result.schema) as writer:
    writer.write_table(result)
reader = con.sql("SELECT * FROM input_data").to_arrow_reader(batch_size=1)
assert [batch.num_rows for batch in reader] == [1, 1]
assert pq.read_table("data/analysis.parquet").column("id").to_pylist() == [9007199254740993, None]
duckdb.sql("CREATE TABLE default_only AS SELECT 42 AS n")
print("python-data-ok")`,
      ),
    chatId,
  );
  expect(python, python.error).toMatchObject({ success: true, output: "python-data-ok" });
  expect(python.files?.["/data/analysis.duckdb"]?.contentType).toBe("application/octet-stream");
  expect(python.files?.["/data/analysis.duckdb.wal"]).toBeUndefined();

  const javascript = await page.evaluate(
    (id) =>
      window.interpreterE2E.executeWorkspace(
        "javascript",
        id,
        `const table = arrow.tableFromIPC(vfs.readBytes("data/python.arrow"));
if (table.getChild("id").get(0) !== 9007199254740993n || table.getChild("id").get(1) !== null) throw new Error("Arrow values changed");
vfs.writeBytes("data/javascript.arrow", arrow.tableToIPC(table, "file"));
vfs.writeBytes("data/stream.arrow", arrow.tableToIPC(table, "stream"));
const result = await sql("SELECT sum(amount) AS total FROM 'data/analysis.parquet'");
return result.rows[0].total;`,
      ),
    chatId,
  );
  expect(javascript, javascript.error).toMatchObject({ success: true, output: "14" });

  const reopened = await page.evaluate(
    (id) =>
      window.interpreterE2E.executeWorkspace(
        "python",
        id,
        `import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
assert duckdb.sql("SHOW TABLES").fetchall() == []
table = pa.ipc.open_file("data/javascript.arrow").read_all()
assert table.column("id").to_pylist() == [9007199254740993, None]
assert pa.ipc.open_stream("data/stream.arrow").read_all().equals(table)
pq.write_table(table, "data/roundtrip.parquet")
with duckdb.connect("data/analysis.duckdb", read_only=True) as con:
    assert con.execute("SELECT sum(amount) FROM saved").fetchone()[0] == 14.0
assert (await sql("SELECT sum(amount) AS total FROM 'analysis.parquet'"))["rows"][0]["total"] == 14.0
print("roundtrip-ok")`,
      ),
    chatId,
  );
  expect(reopened, reopened.error).toMatchObject({ success: true, output: "roundtrip-ok" });
  expect(reopened.files?.["/data/analysis.duckdb"]?.content === python.files?.["/data/analysis.duckdb"]?.content).toBe(
    true,
  );

  const preview = await page.evaluate(
    (id) => window.interpreterE2E.queryWorkspace(id, "SELECT id, amount FROM 'roundtrip.parquet' ORDER BY amount DESC"),
    chatId,
  );
  expect(preview.rows).toEqual([
    { id: "9007199254740993", amount: 4.5 },
    { id: null, amount: 2.5 },
  ]);
});

test("DuckDB state is isolated across chats and failed database edits never commit", async ({ page }) => {
  const firstChat = `first-${crypto.randomUUID()}`;
  const secondChat = `second-${crypto.randomUUID()}`;
  const first = await page.evaluate(
    (id) =>
      window.interpreterE2E.executeWorkspace(
        "python",
        id,
        `import duckdb
duckdb.sql("CREATE TABLE private_data AS SELECT 42 AS n")
con = duckdb.connect("saved.duckdb")
con.execute("CREATE TABLE saved AS SELECT 7 AS n")
print("created")`,
      ),
    firstChat,
  );
  expect(first, first.error).toMatchObject({ success: true, output: "created" });
  const second = await page.evaluate(
    (id) =>
      window.interpreterE2E.executeWorkspace(
        "python",
        id,
        `import duckdb
from pathlib import Path
assert duckdb.sql("SHOW TABLES").fetchall() == []
assert not Path("saved.duckdb").exists()
assert duckdb.sql("SELECT current_setting('memory_limit')").fetchone()[0] == '244.1 MiB'
with duckdb.connect() as con:
    assert con.sql("SELECT current_setting('threads')").fetchone()[0] == 1
    assert con.sql("SELECT current_setting('memory_limit')").fetchone()[0] == '244.1 MiB'
with duckdb.connect(config={"memory_limit": "64MB"}) as con:
    assert con.sql("SELECT current_setting('memory_limit')").fetchone()[0] == '61.0 MiB'
print("isolated")`,
      ),
    secondChat,
  );
  expect(second, second.error).toMatchObject({ success: true, output: "isolated" });
  const failed = await page.evaluate(
    (id) =>
      window.interpreterE2E.executeWorkspace(
        "python",
        id,
        `import duckdb
con = duckdb.connect("saved.duckdb")
con.execute("INSERT INTO saved VALUES (8)")
raise RuntimeError("deliberate failure")`,
      ),
    firstChat,
  );
  expect(failed.success).toBe(false);
  expect(failed.error).toContain("deliberate failure");
  const restored = await page.evaluate(
    (id) =>
      window.interpreterE2E.executeWorkspace(
        "python",
        id,
        `import duckdb
assert duckdb.sql("SHOW TABLES").fetchall() == []
with duckdb.connect("saved.duckdb") as con:
    assert con.sql("SELECT * FROM saved").fetchall() == [(7,)]
print("original-intact")`,
      ),
    firstChat,
  );
  expect(restored, restored.error).toMatchObject({ success: true, output: "original-intact" });
});
