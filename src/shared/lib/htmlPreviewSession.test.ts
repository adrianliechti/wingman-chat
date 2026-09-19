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
    const responsePort = { postMessage: vi.fn() };
    recoveryListener?.({
      data: { type: "html-preview/recover-request", token: session.token },
      ports: [responsePort],
    } as unknown as MessageEvent);

    expect(responsePort.postMessage).toHaveBeenCalledWith({
      ok: true,
      files: {
        "index.html": { content: "<h1>Updated</h1>", contentType: "text/html" },
        "assets/styles.css": { content: "h1 { color: red; }", contentType: "text/css" },
      },
    });

    await session.destroy();
    expect(workerMessages).toContainEqual({ type: "html-preview/unregister", token: session.token });
    const destroyedPort = { postMessage: vi.fn() };
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

    await session.updateFile("/index.html", { path: "/index.html", content: "<html><head></head></html>", contentType: "text/html" });
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
