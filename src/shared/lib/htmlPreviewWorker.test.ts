import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import source from "../../../public/html-preview-sw.js?raw";

interface Snapshot {
  files: Record<string, { content: string }>;
  revision?: number;
  libraries?: Record<string, string>;
}

function worker() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const clients = [
    {
      id: "owner",
      postMessage: vi.fn((_message: unknown, ports: MessagePort[]) => ports[0].postMessage({ ok: false })),
    },
  ];
  const cache = new Map<string, Response>();
  runInNewContext(source, {
    self: {
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) =>
        handlers.set(name, handler),
      clients: { matchAll: async () => clients },
      location: { href: "https://app.test/html-preview-sw.js" },
    },
    caches: {
      open: async () => ({
        match: async (url: string) => cache.get(url)?.clone(),
        put: async (url: string, response: Response) => cache.set(url, response),
      }),
    },
    fetch: async (url: string) => new Response(url),
    Date,
    URL,
    Request,
    Response,
    Headers,
    ArrayBuffer,
    AbortController,
    MessageChannel,
    setTimeout,
    clearTimeout,
  });
  return {
    clients,
    async message(data: Record<string, unknown>, owner = "owner") {
      const port = { postMessage: vi.fn(), close: vi.fn() };
      const work: Promise<unknown>[] = [];
      handlers.get("message")!({
        data,
        source: { id: owner },
        ports: [port],
        waitUntil: (promise: Promise<unknown>) => work.push(promise),
      });
      await Promise.all(work);
      expect(port.close).toHaveBeenCalledOnce();
      return port.postMessage.mock.calls[0]?.[0];
    },
    fetch(token: string, path = "index.html"): Promise<Response> {
      let response!: Promise<Response>;
      handlers.get("fetch")!({
        request: new Request(`https://app.test/__preview__/${token}/${path}`),
        respondWith: (promise: Promise<Response>) => {
          response = promise;
        },
        waitUntil: (promise: Promise<unknown>) => {
          void promise;
        },
      });
      return response;
    },
    holdRecovery() {
      let reply!: (snapshot: Snapshot) => void;
      clients[0].postMessage.mockImplementation((_message, ports) => {
        reply = (snapshot) => ports[0].postMessage({ ok: true, ...snapshot });
      });
      return {
        ready: () => vi.waitFor(() => expect(clients[0].postMessage).toHaveBeenCalled()),
        reply: (snapshot: Snapshot) => reply(snapshot),
      };
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("preview service worker ownership", () => {
  it("does not resurrect an unregistered session from a delayed recovery reply", async () => {
    const sw = worker();
    const recovery = sw.holdRecovery();
    const response = sw.fetch("closed");
    await recovery.ready();
    expect(await sw.message({ type: "html-preview/unregister", token: "closed" })).toEqual({ ok: true });
    recovery.reply({ files: { "index.html": { content: "stale" } } });
    expect((await response).status).toBe(404);
  });

  it("preserves a fresh registration when an older recovery is still pending", async () => {
    const sw = worker();
    const recovery = sw.holdRecovery();
    const response = sw.fetch("current");
    await recovery.ready();
    await sw.message({
      type: "html-preview/register",
      token: "current",
      revision: 2,
      files: { "index.html": { content: "new" } },
    });
    recovery.reply({ revision: 1, files: { "index.html": { content: "old" } } });
    expect(await (await response).text()).toBe("new");
  });

  it("recovers before applying an update and never overwrites a newer snapshot", async () => {
    const sw = worker();
    const recovery = sw.holdRecovery();
    const update = sw.message({
      type: "html-preview/update",
      token: "current",
      revision: 1,
      path: "index.html",
      file: { content: "old" },
    });
    await recovery.ready();
    recovery.reply({ revision: 2, files: { "index.html": { content: "new" } } });
    expect(await update).toEqual({ ok: true });
    expect(await (await sw.fetch("current")).text()).toBe("new");
  });

  it("keeps library versions separate between sessions and removes deleted folders", async () => {
    const sw = worker();
    for (const token of ["a", "b"]) {
      await sw.message({
        type: "html-preview/register",
        token,
        files: { "folder/one.txt": { content: "one" }, "folder/two.txt": { content: "two" } },
        libraries: { "chart.js": `https://app.test/${token}/chart.js` },
      });
    }
    expect(await (await sw.fetch("a", ".lib/chart.js")).text()).toBe("https://app.test/a/chart.js");
    expect(await (await sw.fetch("b", ".lib/chart.js")).text()).toBe("https://app.test/b/chart.js");
    await sw.message({ type: "html-preview/delete", token: "a", path: "folder" });
    expect((await sw.fetch("a", "folder/one.txt")).status).toBe(404);
    expect((await sw.fetch("a", "folder/two.txt")).status).toBe(404);
    expect(await (await sw.fetch("b", "folder/one.txt")).text()).toBe("one");
  });

  it("reclaims sessions when their owner page closes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(100_000);
    const sw = worker();
    await sw.message({ type: "html-preview/register", token: "closed", files: { "index.html": { content: "old" } } });
    sw.clients.length = 0;
    vi.setSystemTime(131_000);
    await sw.message({ type: "html-preview/ping" });
    expect((await sw.fetch("closed")).status).toBe(404);
  });
});
