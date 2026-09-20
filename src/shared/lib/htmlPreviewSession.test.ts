import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewSession } from "./htmlPreviewSession";

describe("HTML preview session recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a current page-side snapshot for a restarted service worker", async () => {
    const workerMessages: unknown[] = [];
    let recoveryListener: ((event: MessageEvent) => void) | undefined;
    const worker = {
      state: "activated",
      postMessage(message: unknown, transfer?: Transferable[]) {
        workerMessages.push(message);
        (transfer?.[0] as MessagePort | undefined)?.postMessage({ ok: true });
      },
    };
    const serviceWorker = {
      register: vi.fn(async () => ({ active: worker })),
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === "message") recoveryListener = listener;
      }),
    };
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { serviceWorker });

    const session = await createPreviewSession();
    await session.setFiles([
      { path: "/index.html", content: "<h1>Initial</h1>", contentType: "text/html" },
      { path: "/styles.css", content: "h1 { color: red; }", contentType: "text/css" },
    ]);
    await session.updateFile("/index.html", {
      path: "/index.html",
      content: "<h1>Updated</h1>",
      contentType: "text/html",
    });
    await session.renameFile("/styles.css", "/assets/styles.css");

    expect(recoveryListener).toBeDefined();
    const responsePort = { postMessage: vi.fn(), close: vi.fn() };
    recoveryListener?.({
      data: { type: "html-preview/recover-request", token: session.token },
      ports: [responsePort],
    } as unknown as MessageEvent);

    expect(responsePort.postMessage).toHaveBeenCalledWith({
      ok: true,
      revision: 3,
      files: {
        "index.html": { content: "<h1>Updated</h1>", contentType: "text/html" },
        "assets/styles.css": { content: "h1 { color: red; }", contentType: "text/css" },
      },
      libraries: expect.objectContaining({ "echarts.js": expect.any(String), "three.js": expect.any(String) }),
    });
    expect(workerMessages[0]).toMatchObject({
      type: "html-preview/register",
      libraries: { "echarts.js": expect.any(String), "three.js": expect.any(String), "lucide.js": expect.any(String) },
    });

    await session.destroy();
    expect(workerMessages).toContainEqual({ type: "html-preview/unregister", token: session.token });
    const destroyedPort = { postMessage: vi.fn(), close: vi.fn() };
    recoveryListener?.({
      data: { type: "html-preview/recover-request", token: session.token },
      ports: [destroyedPort],
    } as unknown as MessageEvent);
    expect(destroyedPort.postMessage).toHaveBeenCalledWith({ ok: false });
  });
});

describe("HTML preview session SDK injection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The module caches its worker registration; a fresh copy sees the new stub.
  async function freshCreatePreviewSession() {
    vi.resetModules();
    return (await import("./htmlPreviewSession")).createPreviewSession;
  }

  function stubWorker() {
    const messages: Array<Record<string, unknown>> = [];
    let recoveryListener: ((event: MessageEvent) => void) | undefined;
    const worker = {
      state: "activated",
      postMessage(message: Record<string, unknown>, transfer?: Transferable[]) {
        messages.push(message);
        (transfer?.[0] as MessagePort | undefined)?.postMessage({ ok: true });
      },
    };
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => ({ active: worker })),
        addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
          if (type === "message") recoveryListener = listener;
        }),
      },
    });
    return { messages, recover: () => recoveryListener };
  }

  const capabilities = {
    llm: true,
    vision: false,
    ocr: false,
    translate: false,
    render: false,
    synthesize: false,
    transcribe: false,
    files: true,
    store: true,
    tools: false,
    duckdb: true,
  };

  it("serves the SDK and tags every HTML document, leaving other files and reserved paths alone", async () => {
    const { messages } = stubWorker();
    const session = await (await freshCreatePreviewSession())({ sdk: { source: "window.wingman = 1;", capabilities } });
    await session.setFiles([
      { path: "/index.html", content: "<html><head></head><body>a</body></html>", contentType: "text/html" },
      { path: "/pages/about.html", content: "<p>about</p>", contentType: "text/html;charset=utf-8" },
      { path: "/styles.css", content: "p{}", contentType: "text/css" },
      { path: "/__wingman__/evil.js", content: "hack()", contentType: "text/javascript" },
    ]);

    const registered = messages.find((message) => message.type === "html-preview/register") as {
      files: Record<string, { content?: string }>;
    };
    expect(registered.files["__wingman__/sdk.js"]).toEqual({
      content: "window.wingman = 1;",
      contentType: "text/javascript;charset=utf-8",
    });
    expect(registered.files["__wingman__/evil.js"]).toBeUndefined();
    expect(registered.files["index.html"].content).toContain(`/__preview__/${session.token}/__wingman__/sdk.js`);
    expect(registered.files["index.html"].content).toContain('data-path="/index.html"');
    expect(registered.files["pages/about.html"].content).toMatch(/^<script .*data-path="\/pages\/about.html"/);
    expect(registered.files["styles.css"].content).toBe("p{}");

    await session.updateFile("/index.html", {
      path: "/index.html",
      content: "<html><head></head></html>",
      contentType: "text/html",
    });
    const updated = messages.findLast((message) => message.type === "html-preview/update") as {
      file: { content: string };
    };
    expect(updated.file.content).toContain("__wingman__/sdk.js");
    expect(updated.file.content).toContain('data-capabilities="{&quot;llm&quot;:true');

    // Toggling a capability re-serves every document with the new declaration.
    await session.setCapabilities({ ...capabilities, tools: true });
    const reregistered = messages.findLast((message) => message.type === "html-preview/register") as {
      files: Record<string, { content?: string }>;
    };
    expect(reregistered.files["index.html"].content).toContain("&quot;tools&quot;:true");
    expect(reregistered.files["__wingman__/sdk.js"]).toBeDefined();
    await session.destroy();
  });

  it("changes nothing without SDK options", async () => {
    const { messages } = stubWorker();
    const session = await (await freshCreatePreviewSession())();
    await session.setFiles([{ path: "/index.html", content: "<html></html>", contentType: "text/html" }]);
    const registered = messages.find((message) => message.type === "html-preview/register") as {
      files: Record<string, { content?: string }>;
    };
    expect(registered.files).toEqual({ "index.html": { content: "<html></html>", contentType: "text/html" } });
    await session.destroy();
  });
});

describe("HTML preview session library references", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("points absolute /.lib/ references at the session so the worker can serve them", async () => {
    const messages: Array<Record<string, unknown>> = [];
    const worker = {
      state: "activated",
      postMessage(message: Record<string, unknown>, transfer?: Transferable[]) {
        messages.push(message);
        (transfer?.[0] as MessagePort | undefined)?.postMessage({ ok: true });
      },
    };
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      serviceWorker: { register: vi.fn(async () => ({ active: worker })), addEventListener: vi.fn() },
    });
    vi.resetModules();
    const { createPreviewSession: create } = await import("./htmlPreviewSession");
    const session = await create();
    await session.setFiles([
      { path: "/pages/a.html", content: '<script src="/.lib/echarts.js"></script>', contentType: "text/html" },
      { path: "/notes.txt", content: 'src="/.lib/echarts.js"', contentType: "text/plain" },
    ]);
    const registered = messages.find((message) => message.type === "html-preview/register") as {
      files: Record<string, { content?: string }>;
    };
    expect(registered.files["pages/a.html"].content).toBe(
      `<script src="/__preview__/${session.token}/.lib/echarts.js"></script>`,
    );
    expect(registered.files["notes.txt"].content).toBe('src="/.lib/echarts.js"');
    await session.destroy();
  });
});

describe("HTML preview session lifetime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function setup() {
    vi.resetModules();
    const worker = Object.assign(new EventTarget(), {
      state: "activated",
      postMessage: vi.fn((_message: unknown, transfer?: Transferable[]) => {
        const port = transfer?.[0] as MessagePort | undefined;
        port?.postMessage({ ok: true });
        port?.close();
      }),
    });
    const register = vi.fn(async () => ({ active: worker }));
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { serviceWorker: { register, addEventListener: vi.fn() } });
    const { createPreviewSession: create } = await import("./htmlPreviewSession");
    return { worker, register, create };
  }

  it.each(["timeout", "redundant"])("releases activation listeners and allows retry after %s", async (failure) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { worker, register, create } = await setup();
    worker.state = "installing";
    const removeListener = vi.spyOn(worker, "removeEventListener");
    const opening = expect(create()).rejects.toThrow(/activation (timed out|failed)/);
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(10_000);
    else {
      worker.state = "redundant";
      worker.dispatchEvent(new Event("statechange"));
    }
    await opening;
    expect(removeListener).toHaveBeenCalledWith("statechange", expect.any(Function));
    worker.state = "activated";
    const session = await create();
    expect(register).toHaveBeenCalledTimes(2);
    await session.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending acknowledgement when the owner closes, and unregisters only once", async () => {
    const { worker, create } = await setup();
    const owner = new AbortController();
    const session = await create({ signal: owner.signal });
    let reply!: MessagePort;
    worker.postMessage.mockImplementationOnce((_message, transfer) => {
      reply = transfer![0] as MessagePort;
    });
    const pending = session.setFiles([{ path: "/index.html", content: "page" }]);
    const cancelled = expect(pending).rejects.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reply).toBeDefined();
    owner.abort();
    const closing = session.destroy();
    expect(session.destroy()).toBe(closing);
    await cancelled;
    await closing;
    reply.close();
    expect(worker.postMessage.mock.calls.map(([message]) => (message as { type: string }).type)).toEqual([
      "html-preview/register",
      "html-preview/unregister",
    ]);
  });

  it("never sends a delayed registration after destruction", async () => {
    const { worker, create } = await setup();
    const session = await create();
    const registering = session.setFiles([{ path: "/index.html", content: "page" }]);
    const cancelled = expect(registering).rejects.toThrow();
    await session.destroy();
    await cancelled;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[0][0]).toEqual({ type: "html-preview/unregister", token: session.token });
  });
});
