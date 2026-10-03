import { describe, expect, it, vi } from "vitest";
import type { Client } from "@/shared/lib/client";
import { outputText as getTextFromContent } from "@/shared/lib/messages";
import { pageExcerpt } from "./webContent";
import { buildWebTools } from "./webTools";

function fixture() {
  const client = {
    search: vi.fn<Client["search"]>().mockResolvedValue([{ source: "https://example.com", content: "Evidence" }]),
    scrape: vi.fn<Client["scrape"]>().mockResolvedValue("Full source text"),
  };
  const tools = buildWebTools(client as unknown as Client, { searcher: "search", scraper: "scrape" });
  const search = tools.find(({ name }) => name === "web_search")!;
  const fetch = tools.find(({ name }) => name === "web_fetch")!;
  const context = { signal: new AbortController().signal };
  return { client, tools, search, fetch, context };
}

it("deduplicates batches and passes the requested result limit to the backend", async () => {
  const { search, client, context } = fixture();
  const result = getTextFromContent(
    await search.execute(
      { queries: ["topic", " topic ", ""], domains: ["example.com", "example.com"], limit: 3 },
      { context: context, emitCustomEvent() {} },
    ),
  );
  expect(client.search).toHaveBeenCalledExactlyOnceWith(
    "search",
    "topic",
    { domains: ["example.com"], limit: 3 },
    { signal: context.signal },
  );
  expect(result.match(/## Query:/g)).toHaveLength(1);
});

it("shares concurrent/repeated requests only within the same run and query options", async () => {
  const { search, client, context } = fixture();
  await Promise.all([
    search.execute(
      { queries: ["topic"], domains: ["b.example", "a.example"] },
      { context: context, emitCustomEvent() {} },
    ),
    search.execute(
      { queries: ["topic"], domains: ["a.example", "b.example"] },
      { context: context, emitCustomEvent() {} },
    ),
  ]);
  expect(client.search).toHaveBeenCalledTimes(1);
  await search.execute(
    { queries: ["topic"], domains: ["a.example", "b.example"], limit: 2 },
    { context: context, emitCustomEvent() {} },
  );
  await search.execute({ queries: ["topic"] }, { context: context, emitCustomEvent() {} });
  await search.execute(
    { queries: ["topic"] },
    { context: { signal: new AbortController().signal }, emitCustomEvent() {} },
  );
  expect(client.search).toHaveBeenCalledTimes(4);
});

it("does not cache errors or empty results, and preserves successful batch members", async () => {
  const { search, client, context } = fixture();
  client.search.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
  const result = getTextFromContent(
    await search.execute({ queries: ["failed", "empty", "ok"] }, { context: context, emitCustomEvent() {} }),
  );
  expect(result).toContain("offline");
  expect(result).toContain("No results found");
  expect(result).toContain("Evidence");
  await search.execute({ queries: ["failed", "empty", "ok"] }, { context: context, emitCustomEvent() {} });
  expect(client.search).toHaveBeenCalledTimes(5);
});

it("reads relevant text beyond the old truncation point and paginates without another fetch", async () => {
  const { fetch, client, context } = fixture();
  const page = "Background. ".repeat(1800) + "The launch date is 14 May 2031. " + "Appendix. ".repeat(300);
  client.scrape.mockResolvedValue(page);
  const first = getTextFromContent(
    await fetch.execute(
      { urls: ["https://example.com", " https://example.com "] },
      { context: context, emitCustomEvent() {} },
    ),
  );
  expect(first).toContain("offset=6000");
  expect(first).not.toContain("14 May 2031");
  const focused = getTextFromContent(
    await fetch.execute(
      { urls: ["https://example.com"], query: "launch date" },
      { context: context, emitCustomEvent() {} },
    ),
  );
  expect(focused).toContain("The launch date is 14 May 2031.");
  expect(focused).toContain("other passages omitted");
  const next = getTextFromContent(
    await fetch.execute(
      { urls: ["https://example.com"], offset: 21000, max_chars: 1000 },
      { context: context, emitCustomEvent() {} },
    ),
  );
  expect(next).toContain(page.slice(21000, 22000));
  expect(client.scrape).toHaveBeenCalledTimes(1);
});

it("bounds cache retention and never shares a page across runs or unscoped calls", async () => {
  const { fetch, client, context } = fixture();
  for (let i = 0; i < 17; i++)
    await fetch.execute({ urls: [`https://example.com/${i}`] }, { context: context, emitCustomEvent() {} });
  await fetch.execute({ urls: ["https://example.com/0"] }, { context: context, emitCustomEvent() {} });
  expect(client.scrape).toHaveBeenCalledTimes(18);
  await fetch.execute(
    { urls: ["https://example.com/0"] },
    { context: { signal: new AbortController().signal }, emitCustomEvent() {} },
  );
  await fetch.execute({ urls: ["https://example.com/0"] });
  await fetch.execute({ urls: ["https://example.com/0"] });
  expect(client.scrape).toHaveBeenCalledTimes(21);
  client.scrape.mockResolvedValue("x".repeat(256001));
  await fetch.execute({ urls: ["https://example.com/large"] }, { context: context, emitCustomEvent() {} });
  await fetch.execute({ urls: ["https://example.com/large"] }, { context: context, emitCustomEvent() {} });
  expect(client.scrape).toHaveBeenCalledTimes(23);
});

it("limits concurrency to four and retains input order and partial failures", async () => {
  const { fetch, client, context } = fixture();
  const pending: { resolve: (text: string) => void; reject: (error: Error) => void }[] = [];
  client.scrape.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
  const result = fetch.execute({ urls }, { context: context, emitCustomEvent() {} });
  await vi.waitFor(() => expect(client.scrape).toHaveBeenCalledTimes(4));
  pending[1].resolve("Second");
  await vi.waitFor(() => expect(client.scrape).toHaveBeenCalledTimes(5));
  pending[0].reject(new Error("First failed"));
  await vi.waitFor(() => expect(client.scrape).toHaveBeenCalledTimes(6));
  pending.slice(2).forEach((item) => item.resolve("Other"));
  const text = getTextFromContent(await result);
  expect(text).toContain("First failed");
  expect(text).toContain("Second");
  expect(urls.map((url) => text.indexOf(url))).toEqual(urls.map((url) => text.indexOf(url)).sort((a, b) => a - b));
});

it("propagates cancellation and does not start queued requests", async () => {
  const { fetch, client } = fixture();
  const controller = new AbortController();
  client.scrape.mockImplementation(
    (_model, _url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      }),
  );
  const result = fetch.execute(
    { urls: Array.from({ length: 8 }, (_, i) => `https://example.com/${i}`) },
    { context: { signal: controller.signal }, emitCustomEvent() {} },
  );
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(client.scrape).toHaveBeenCalledTimes(4));
  controller.abort();
  await rejected;
  expect(client.scrape).toHaveBeenCalledTimes(4);
  await expect(
    fetch.execute(
      { urls: ["https://example.com/0"] },
      { context: { signal: controller.signal }, emitCustomEvent() {} },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it.each([
  ["web_search", { queries: "topic" }],
  ["web_search", { queries: Array.from({ length: 9 }, (_, i) => String(i)) }],
  ["web_search", { queries: ["topic"], limit: 9 }],
  ["web_search", { queries: ["topic"], limit: 1.5 }],
  ["web_fetch", { urls: ["https://example.com"], offset: -1 }],
  ["web_fetch", { urls: ["https://example.com"], query: "launch", offset: 1 }],
  ["web_fetch", { urls: ["https://example.com"], max_chars: 0 }],
  ["web_fetch", { urls: ["https://example.com"], query: 7 }],
])("rejects invalid %s arguments before making requests", async (name, args) => {
  const { tools, client, context } = fixture();
  await expect(
    tools.find((tool) => tool.name === name)!.execute(args, { context: context, emitCustomEvent() {} }),
  ).rejects.toThrow();
  expect(client.search).not.toHaveBeenCalled();
  expect(client.scrape).not.toHaveBeenCalled();
});

describe("verbatim excerpts", () => {
  it("prefers the matching section over captions and common short words", () => {
    const page =
      "A caption about the Palme d’or prize. " +
      "Photo credits and award ceremony. ".repeat(42) +
      "\n\n## Palme d'or\n\nWINNER: The Silver Orchard.\n\n" +
      "More photos and stories. ".repeat(200);
    const result = pageExcerpt(page, "## Palme d'or", 0, 1400);
    expect(result).toContain("WINNER: The Silver Orchard.");
    expect(result).toContain("## Palme d'or");
  });

  it("keeps a query match near a window boundary with a small output budget", () => {
    const page = "a".repeat(1250) + "Launch: 14 May 2031" + "b".repeat(5000);
    const result = pageExcerpt(page, "launch", 0, 1000);
    expect(result).toContain("Launch: 14 May 2031");
    expect(result.length).toBeLessThan(1300);
  });

  it("labels unmatched queries, empty pages and out-of-range offsets", () => {
    expect(pageExcerpt("a".repeat(2000), "missing", 0, 1000)).toContain("No literal query terms matched");
    expect(pageExcerpt("  ", "", 0, 1000)).toContain("No text content");
    expect(pageExcerpt("short", "", 100, 1000)).toContain("past the end");
  });

  it("preserves exact source offsets, whitespace, and non-ASCII text", () => {
    const page = "  Intro\n" + "背景 ".repeat(3000) + "公開日：2031年5月14日。\n";
    const result = pageExcerpt(page, "公開日", 0, 1000);
    expect(result).toContain("公開日：2031年5月14日。");
    const range = /\[Characters (\d+)–(\d+)\]/.exec(result)!;
    expect(result).toContain(page.slice(Number(range[1]), Number(range[2])));
    expect(pageExcerpt(page, "", 2, 1000)).toContain(page.slice(2, 1002));
  });
});
