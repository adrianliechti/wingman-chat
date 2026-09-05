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
