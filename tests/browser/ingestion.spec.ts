import { expect, test, type Page, type Route } from "@playwright/test";

async function open(page: Page) {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], repository: { embedder: "embed-a" }, extractor: { files: [".ingest"] } } }),
  );
  await page.route("**/api/v1/extract", (route) => route.fulfill({ body: "Extracted source" }));
  await page.route("**/api/v1/segment", (route) => route.fulfill({ json: ["First chunk", "Second chunk"] }));
  await page.route("**/api/v1/embeddings", (route) =>
    route.fulfill({ json: { model: "embed-a", data: [{ embedding: [1, 0], index: 0 }] } }),
  );
  await page.goto("/tests/browser/fixtures/ingestion.html");
  await page.waitForFunction(() => !!window.ingestionE2E);
  const id = await page.evaluate(async () => (await window.ingestionE2E.createAgent("Original")).id);
  await page.waitForFunction((id) => window.ingestionE2E.state().current?.id === id, id);
  return id;
}

function hold(page: Page, url: string) {
  let captured!: (route: Route) => void;
  const route = new Promise<Route>((resolve) => {
    captured = resolve;
  });
  return page
    .route(url, (request) => {
      captured(request);
    })
    .then(() => route);
}

test("deleting from another consumer during conversion cannot resurrect a failed file", async ({ page }) => {
  const id = await open(page);
  const pending = hold(page, "**/api/v1/extract");
  await page.evaluate(() => window.ingestionE2E.startAdd());
  const route = await pending;
  await page.evaluate(() => window.ingestionE2E.remove(window.ingestionE2E.state().current!.files![0].id));
  await route.fulfill({ status: 400, body: "Conversion failed" });
  await page.evaluate(() => window.ingestionE2E.finish());
  await page.evaluate(() => window.ingestionE2E.flush());
  expect(await page.evaluate(() => window.ingestionE2E.state().current!.files)).toEqual([]);
  expect(await page.evaluate((id) => window.ingestionE2E.read(`agents/${id}/files/index.json`), id)).toEqual([]);
});

test("switching agents during conversion lets the original upload finish in its own agent", async ({ page }) => {
  const id = await open(page);
  const pending = hold(page, "**/api/v1/extract");
  await page.evaluate(() => window.ingestionE2E.startAdd());
  const route = await pending;
  const second = await page.evaluate(async () => (await window.ingestionE2E.createAgent("Other")).id);
  await page.waitForFunction((id) => window.ingestionE2E.state().current?.id === id, second);
  await route.fulfill({ body: "Extracted source" });
  await page.evaluate(() => window.ingestionE2E.finish());
  await page.evaluate(() => window.ingestionE2E.flush());
  const state = await page.evaluate(() => window.ingestionE2E.state());
  expect(state.agents.find((agent) => agent.id === id)?.files).toMatchObject([
    { status: "completed", text: "Extracted source", segments: [{ text: "First chunk" }, { text: "Second chunk" }] },
  ]);
  expect(state.current?.files ?? []).toEqual([]);
});

test("a search finishing after deletion cannot return the removed file", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.ingestionE2E.startAdd("notes.txt"));
  await page.evaluate(() => window.ingestionE2E.finish());
  await page.waitForFunction(() => window.ingestionE2E.state().current?.files?.[0].status === "completed");
  const pending = hold(page, "**/api/v1/embeddings");
  await page.evaluate(() => window.ingestionE2E.startQuery("Find source"));
  const route = await pending;
  await page.evaluate(() => window.ingestionE2E.remove(window.ingestionE2E.state().current!.files![0].id));
  await route.fulfill({ json: { model: "embed-a", data: [{ embedding: [1, 0], index: 0 }] } });
  expect(await page.evaluate(() => window.ingestionE2E.finishQuery())).toEqual([]);
});

test("simultaneous uploads from different consumers allocate distinct stable paths", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.ingestionE2E.startTwo());
  await page.evaluate(() => window.ingestionE2E.finish());
  await page.evaluate(() => window.ingestionE2E.flush());
  const files = await page.evaluate(() => window.ingestionE2E.state().current!.files!);
  expect(files).toHaveLength(2);
  expect(new Set(files.map((file) => file.path)).size).toBe(2);
  await page.reload();
  await page.waitForFunction(() => window.ingestionE2E?.state().current?.files?.length === 2);
  expect(await page.evaluate(() => window.ingestionE2E.state().current!.files!.map(({ path }) => path))).toEqual(
    files.map(({ path }) => path),
  );
});

test("partial embedding failure aborts active requests, stops queued chunks and can be retried after reload", async ({
  page,
}) => {
  await open(page);
  const requests: Route[] = [];
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().endsWith("/embeddings")) aborted.push(request.url());
  });
  await page.route("**/api/v1/segment", (route) =>
    route.fulfill({ json: Array.from({ length: 12 }, (_, i) => `Chunk ${i}`) }),
  );
  await page.route("**/api/v1/embeddings", (route) => {
    requests.push(route);
  });
  await page.evaluate(() => window.ingestionE2E.startAdd("notes.txt", "Retry this source"));
  await expect.poll(() => requests.length).toBe(10);
  const original = await page.evaluate(() => window.ingestionE2E.state().current!.files![0]);
  await requests[0].fulfill({ status: 400, json: { error: { message: "Embedding quota exhausted" } } });
  await page.evaluate(() => window.ingestionE2E.finish());
  await expect.poll(() => aborted.length).toBe(9);
  expect(requests).toHaveLength(10);
  expect(await page.evaluate(() => window.ingestionE2E.state().current!.files![0])).toMatchObject({
    status: "error",
    text: "Retry this source",
    segments: undefined,
    error: expect.stringContaining("Embedding quota exhausted"),
  });
  await page.route("**/api/v1/embeddings", (route) =>
    route.fulfill({ json: { model: "embed-a", data: [{ embedding: [1, 0], index: 0 }] } }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Retry indexing notes.txt" }).click();
  await page.waitForFunction(() => window.ingestionE2E.state().current?.files?.[0].status === "completed");
  await page.evaluate(() => window.ingestionE2E.flush());
  const result = await page.evaluate(() => window.ingestionE2E.state().current!.files![0]);
  expect(result).toMatchObject({
    id: original.id,
    path: original.path,
    uploadedAt: original.uploadedAt,
    text: "Retry this source",
  });
  expect(result.segments).toHaveLength(12);
});

test("model changes require reindexing and the replacement model survives persistence and reload", async ({ page }) => {
  const agentId = await open(page);
  await page.evaluate(() => window.ingestionE2E.startAdd("notes.txt"));
  await page.evaluate(() => window.ingestionE2E.finish());
  const original = await page.evaluate(() => window.ingestionE2E.state().current!.files![0]);
  expect(original).toMatchObject({ embeddingRequestModel: "embed-a", embeddingModel: "embed-a" });
  await page.evaluate(() => window.ingestionE2E.setModel("embed-b"));
  const error = await page.evaluate(() =>
    window.ingestionE2E.search("Query").then(
      () => "unexpected success",
      (error: Error) => error.message,
    ),
  );
  expect(error).toContain("reindexing");
  await expect(page.getByText("Reindex to enable semantic search with the current model.")).toBeVisible();
  await page.route("**/api/v1/embeddings", (route) =>
    route.fulfill({ json: { model: "embed-b", data: [{ embedding: [0, 1], index: 0 }] } }),
  );
  await page.getByRole("button", { name: "Reindex notes.txt", exact: true }).click();
  await page.waitForFunction(() => window.ingestionE2E.state().current?.files?.[0].embeddingModel === "embed-b");
  await page.evaluate(() => window.ingestionE2E.flush());
  expect(
    await page.evaluate(
      ({ agentId, fileId }) => window.ingestionE2E.read(`agents/${agentId}/files/${fileId}/metadata.json`),
      { agentId, fileId: original.id },
    ),
  ).toMatchObject({ embeddingRequestModel: "embed-b", embeddingModel: "embed-b" });
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], repository: { embedder: "embed-b" } } }),
  );
  await page.reload();
  await page.waitForFunction(() => window.ingestionE2E?.state().current?.files?.[0].status === "completed");
  const results = await page.evaluate(() => window.ingestionE2E.search("Query"));
  expect(results).toHaveLength(2);
  expect(results[0].file).toMatchObject({ id: original.id, path: original.path, embeddingModel: "embed-b" });
});

test("deleting an agent aborts segmentation and cannot leave files or index entries behind", async ({ page }) => {
  const id = await open(page);
  const pending = hold(page, "**/api/v1/segment");
  await page.evaluate(() => window.ingestionE2E.startAdd("notes.txt"));
  const route = await pending;
  await page.evaluate((id) => window.ingestionE2E.deleteAgent(id), id);
  await page.evaluate(() => window.ingestionE2E.finish());
  await route.fulfill({ json: ["Late segment"] });
  expect(await page.evaluate(() => window.ingestionE2E.read("agents/index.json"))).toEqual([]);
  expect(await page.evaluate((id) => window.ingestionE2E.read(`agents/${id}/files/index.json`), id)).toBeUndefined();
});

test("reloading an interrupted upload retains extracted text and offers a working retry", async ({ page }) => {
  await open(page);
  const pending = hold(page, "**/api/v1/segment");
  await page.evaluate(() => window.ingestionE2E.startAdd("notes.txt", "Saved extracted text"));
  const route = await pending;
  await page.evaluate(() => window.ingestionE2E.flush());
  await page.route("**/api/v1/segment", (route) => route.fulfill({ json: ["Saved extracted text"] }));
  await page.reload();
  await expect(page.getByText(/File processing was interrupted/)).toBeVisible();
  await route.fulfill({ json: ["Ignored old segment"] });
  await page.getByRole("button", { name: "Retry indexing notes.txt" }).click();
  await page.waitForFunction(() => window.ingestionE2E.state().current?.files?.[0].status === "completed");
  expect(await page.evaluate(() => window.ingestionE2E.state().current!.files![0])).toMatchObject({
    text: "Saved extracted text",
    segments: [{ text: "Saved extracted text" }],
  });
});

test("unmounting the owner cancels the active upload and prevents the rest of its queued batch from starting", async ({
  page,
}) => {
  const agentId = await open(page);
  let requests = 0;
  await page.route("**/api/v1/extract", (route) => {
    if (++requests > 1) return route.fulfill({ body: "Unexpected later upload" });
    // Hold the first request until unmount cancels it.
    return undefined;
  });
  await page.evaluate(() => window.ingestionE2E.startBatch());
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(() => window.showIngestionOwner(false));
  await page.evaluate(() => window.ingestionE2E.finish());
  await page.evaluate(() => window.ingestionE2E.flush());
  expect(requests).toBe(1);
  const ids = await page.evaluate((id) => window.ingestionE2E.read<string[]>(`agents/${id}/files/index.json`), agentId);
  expect(ids).toHaveLength(1);
  expect(
    await page.evaluate(
      ({ agentId, fileId }) => window.ingestionE2E.read(`agents/${agentId}/files/${fileId}/metadata.json`),
      { agentId, fileId: ids![0] },
    ),
  ).toMatchObject({ name: "first.ingest", status: "error", error: expect.stringContaining("interrupted") });
});
