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
      libraries: expect.objectContaining({ "echarts.js": expect.any(String), "three.js": expect.any(String) }),
    });
    expect(workerMessages[0]).toMatchObject({
      type: "html-preview/register",
      libraries: { "echarts.js": expect.any(String), "three.js": expect.any(String), "lucide.js": expect.any(String) },
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

describe("HTML preview session library references", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("points absolute /.lib/ references at the session so the worker can serve them", async () => {
    const messages: Array<Record<string, unknown>> = [];
    const worker = {
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
