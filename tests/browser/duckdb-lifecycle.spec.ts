import { expect, test } from "@playwright/test";

const expensive = "SELECT sum(a.i * b.i) AS n FROM range(1000000) a(i), range(1000000) b(i)";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/duckdb.html");
  await page.waitForFunction(() => window.duckdbE2E);
});

test("disposal cancels initialization and removes every subscription", async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const api = window.duckdbE2E;
    const a = api.create();
    const b = api.create();
    const operations = [api.begin(a, "connect"), api.begin(b, "query")];
    const before = api.stats();
    api.dispose(a);
    api.dispose(b);
    return { before, after: api.stats(), outcomes: await Promise.all(operations.map(api.outcome)) };
  });
  expect(outcome.before.subscriptions).toBe(8);
  expect(outcome.after.subscriptions).toBe(0);
  expect(outcome.after.active).toBe(0);
  expect(outcome.outcomes).toEqual([{ error: "AbortError" }, { error: "AbortError" }]);
});

test("termination during native SQL or connect leaves the next owner healthy", async ({ page }) => {
  const a = await page.evaluate(() => window.duckdbE2E.create());
  await page.evaluate((a) => window.duckdbE2E.query(a, "SELECT 1"), a);
  const queries = await page.evaluate(() => window.duckdbE2E.stats().queries);
  const pending = await page.evaluate(([a, sql]) => window.duckdbE2E.begin(a, "query", sql), [a, expensive]);
  await expect.poll(() => page.evaluate(() => window.duckdbE2E.stats().queries)).toBe(queries + 1);
  await page.evaluate((a) => window.duckdbE2E.dispose(a), a);
  expect(await page.evaluate((key) => window.duckdbE2E.outcome(key), pending)).toEqual({ error: "AbortError" });
  expect(await page.evaluate(() => window.duckdbE2E.stats().active)).toBe(0);

  const b = await page.evaluate(() => window.duckdbE2E.create());
  const result = await page.evaluate((b) => window.duckdbE2E.closeAfterQuery(b), b);
  expect(result.rows).toEqual([{ n: 499999500000 }]);
  // Queue connect and disposal together, as happens when a just-opened preview is closed.
  const connected = await page.evaluate(async (b) => {
    const pending = window.duckdbE2E.begin(b, "connect");
    window.duckdbE2E.dispose(b);
    return window.duckdbE2E.outcome(pending);
  }, b);
  expect(connected).toEqual({ error: "AbortError" });
  expect(await page.evaluate(() => window.duckdbE2E.stats().active)).toBe(0);
});

test("workspace names and temporary tables belong to their owner", async ({ page, browserName }) => {
  // Use immutable files on WebKit: its Playwright OPFS does not implement the writer used by the app.
  const ids = await page.evaluate(async (snapshot) => {
    const api = window.duckdbE2E;
    if (!snapshot) {
      await api.write("chat-a", "owner,value\nA,1\n");
      await api.write("chat-b", "owner,value\nB,2\n");
    }
    return [
      api.create("chat-a", snapshot ? "owner,value\nA,1\n" : undefined),
      api.create("chat-b", snapshot ? "owner,value\nB,2\n" : undefined),
    ];
  }, browserName === "webkit");
  const rows = await page.evaluate(async ([a, b]) => {
    const api = window.duckdbE2E;
    await Promise.all([
      api.query(a, "CREATE TEMP TABLE held AS SELECT 1"),
      api.query(b, "CREATE TEMP TABLE held AS SELECT 2"),
    ]);
    const results = await Promise.all([
      api.query(a, "SELECT owner FROM 'data.csv'"),
      api.query(b, "SELECT owner FROM 'data.csv'"),
    ]);
    api.dispose(b);
    results.push(await api.query(a, "SELECT owner FROM 'data.csv'"));
    api.dispose(a);
    return results.map((result) => result.rows);
  }, ids);
  expect(rows).toEqual([[{ owner: "A" }], [{ owner: "B" }], [{ owner: "A" }]]);
  expect(await page.evaluate(() => window.duckdbE2E.stats().active)).toBe(0);
});

test("large results fail within a budget and the session remains usable", async ({ page }) => {
  const id = await page.evaluate(() => window.duckdbE2E.create());
  const outcome = await page.evaluate(async (id) => {
    const api = window.duckdbE2E;
    const errors: string[] = [];
    for (const sql of ["SELECT * FROM range(100001)", "SELECT repeat('x', 1024) AS payload FROM range(20000)"]) {
      try {
        await api.query(id, sql);
      } catch (error) {
        errors.push(String(error));
      }
    }
    const result = await api.query(id, "SELECT $1::INTEGER AS n", [7]);
    const memory = await api.query(id, "SELECT current_setting('memory_limit') AS memory");
    api.dispose(id);
    return { errors, result, memory };
  }, id);
  expect(outcome.errors).toHaveLength(2);
  for (const error of outcome.errors) expect(error).toContain("SQL result is too large");
  expect(outcome.result.rows).toEqual([{ n: 7 }]);
  expect(outcome.memory.rows).toEqual([{ memory: "244.1 MiB" }]);
});

test("interpreter Stop terminates SQL, and successful runs release their session", async ({ page }) => {
  expect(await page.evaluate(() => window.duckdbE2E.abortedRequest())).toBe("cancelled");
  expect(await page.evaluate(() => window.duckdbE2E.stats().created)).toBe(0);
  await page.evaluate((sql) => window.duckdbE2E.startRun(`await sql(${JSON.stringify(sql)})`), expensive);
  await expect.poll(() => page.evaluate(() => window.duckdbE2E.stats().queries)).toBe(1);
  await page.evaluate(() => window.duckdbE2E.stopRun());
  const cancelled = await page.evaluate(() => window.duckdbE2E.runResult());
  expect(cancelled?.success).toBe(false);
  expect(await page.evaluate(() => window.duckdbE2E.stats().active)).toBe(0);
  const created = await page.evaluate(() => window.duckdbE2E.stats().created);
  await page.evaluate(() =>
    window.duckdbE2E.startRun(
      "await sql('CREATE TEMP TABLE t AS SELECT 7 AS n'); return (await sql('SELECT n FROM t')).rows[0].n;",
    ),
  );
  const finished = await page.evaluate(() => window.duckdbE2E.runResult());
  expect(finished?.success).toBe(true);
  expect(finished?.output).toContain("7");
  expect(await page.evaluate(() => window.duckdbE2E.stats())).toMatchObject({ active: 0, created: created + 1 });
});

test("a timed-out query releases its worker and rejects queued work", async ({ page }) => {
  const id = await page.evaluate(() => window.duckdbE2E.create());
  await page.evaluate((id) => window.duckdbE2E.query(id, "SELECT 1"), id);
  await page.clock.install();
  const keys = await page.evaluate(
    ([id, sql]) => [window.duckdbE2E.begin(id, "query", sql), window.duckdbE2E.begin(id, "connect")],
    [id, expensive],
  );
  await expect.poll(() => page.evaluate(() => window.duckdbE2E.stats().queries)).toBe(2);
  await page.clock.fastForward(121_000);
  for (const key of keys) {
    expect(await page.evaluate((key) => window.duckdbE2E.outcome(key), key)).toEqual({ error: "Error" });
  }
  expect(await page.evaluate(() => window.duckdbE2E.stats())).toMatchObject({ active: 0, subscriptions: 0 });
});
