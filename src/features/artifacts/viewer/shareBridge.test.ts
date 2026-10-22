import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLlm } from "@/features/tools/lib/llmCommand";
import { runOcr } from "@/features/tools/lib/ocrCommand";
import { runTranscribe } from "@/features/tools/lib/transcribeCommand";
import { runTranslateText } from "@/features/tools/lib/translateCommand";
import { runVision } from "@/features/tools/lib/visionCommand";
import { emptyCapabilities, type SdkCapabilities } from "@/shared/lib/artifactSdk/protocol";
import type { DuckDbHost, DuckDbMount } from "@/shared/lib/duckdbHost";
import { expiryLabel, initialPage, type ShareManifest, shareFileUrl } from "./manifest";
import { ShareBridge } from "./shareBridge";

vi.mock("@/features/tools/lib/llmCommand", () => ({ runLlm: vi.fn(async (prompt: string) => `answer: ${prompt}`) }));
vi.mock("@/features/tools/lib/visionCommand", () => ({ runVision: vi.fn(async () => "a chart") }));
vi.mock("@/features/tools/lib/ocrCommand", () => ({ runOcr: vi.fn(async () => "text") }));
vi.mock("@/features/tools/lib/translateCommand", () => ({ runTranslateText: vi.fn(async () => "Hallo") }));
vi.mock("@/features/tools/lib/transcribeCommand", () => ({ runTranscribe: vi.fn(async () => "spoken") }));

const files: Record<string, string> = {
  "/artifacts/abc/files/data/sales.csv": "region,amount\nEU,3\n",
  "/artifacts/abc/files/data/meta.json": '{"name":"Q3"}',
  "/artifacts/abc/files/my%20notes.txt": "notes",
  "/artifacts/abc/files/chart.png": "png",
};

function manifest(capabilities: Partial<SdkCapabilities> = { files: true, store: true, duckdb: true }): ShareManifest {
  return {
    id: "abc",
    title: "Sales",
    entry: "index.html",
    expiresAt: "2026-10-30T12:00:00Z",
    files: ["index.html", "data/sales.csv", "data/meta.json", "my notes.txt", "chart.png"],
    capabilities: { ...emptyCapabilities(), ...capabilities },
  };
}

function fakeHost(mount: DuckDbMount) {
  const query = vi.fn(async () => ({ columns: [], rows: [{ n: 1 }], rowCount: 1 }));
  const dispose = vi.fn();
  const host: DuckDbHost = {
    signal: new AbortController().signal,
    connect: async () => "conn-1",
    close: async () => {},
    query,
    files: async () => ["sales.csv"],
    dispose,
  };
  return { host, mount, query, dispose };
}

beforeEach(() => {
  vi.stubGlobal("location", { href: "https://chat.example.com/artifacts/abc/" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url in files ? new Response(files[url]) : new Response("404 page not found", { status: 404 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ShareBridge files", () => {
  it("lists and reads the share's files", async () => {
    const bridge = new ShareBridge(manifest());

    expect(await bridge.dispatch("doc", "files.list", [])).toEqual([
      "/chart.png",
      "/data/meta.json",
      "/data/sales.csv",
      "/index.html",
      "/my notes.txt",
    ]);
    expect(await bridge.dispatch("doc", "files.exists", ["data/sales.csv"])).toBe(true);
    expect(await bridge.dispatch("doc", "files.exists", ["/missing.csv"])).toBe(false);
    expect(await bridge.dispatch("doc", "files.readText", ["/my notes.txt"])).toBe("notes");
    expect(await bridge.dispatch("doc", "files.readJSON", ["/home/user/data/meta.json"])).toEqual({ name: "Q3" });
    expect(await bridge.dispatch("doc", "files.read", ["/data/sales.csv"])).toEqual(
      new TextEncoder().encode("region,amount\nEU,3\n"),
    );
  });

  it("only fetches files in the share and refuses changes", async () => {
    const bridge = new ShareBridge(manifest());

    await expect(bridge.dispatch("doc", "files.readText", ["/secret.txt"])).rejects.toThrow(
      "File not found: /secret.txt",
    );
    await expect(bridge.dispatch("doc", "files.read", ["/__wingman__/sdk.js"])).rejects.toThrow("is reserved");
    await expect(bridge.dispatch("doc", "files.read", ["../escape"])).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();

    for (const method of ["files.write", "files.writeText", "files.writeJSON", "files.remove"]) {
      await expect(bridge.dispatch("doc", method, ["/x.txt", "x"])).rejects.toThrow("Shared pages are read-only.");
    }
  });
});

describe("ShareBridge store and unavailable helpers", () => {
  it("keeps state for the visit", async () => {
    const bridge = new ShareBridge(manifest());

    expect(await bridge.dispatch("doc", "store.get", ["filter"])).toBeNull();
    await bridge.dispatch("doc", "store.set", ["filter", { region: "EU" }]);
    await bridge.dispatch("doc", "store.set", ["page", 2]);
    expect(await bridge.dispatch("doc", "store.get", ["filter"])).toEqual({ region: "EU" });
    expect(await bridge.dispatch("doc", "store.keys", [])).toEqual(["filter", "page"]);
    await bridge.dispatch("doc", "store.remove", ["page"]);
    await bridge.dispatch("doc", "store.set", ["filter", undefined]);
    expect(await bridge.dispatch("doc", "store.keys", [])).toEqual([]);

    // Other pages of the share see the same store.
    await bridge.dispatch("doc", "store.set", ["theme", "dark"]);
    expect(await bridge.dispatch("next-doc", "store.get", ["theme"])).toBe("dark");

    await expect(bridge.dispatch("next-doc", "store.set", ["__wingman__/x", 1])).rejects.toThrow("is reserved");
  });

  it("refuses what the server did not grant and what would save files", async () => {
    const bridge = new ShareBridge(manifest());

    await expect(bridge.dispatch("doc", "render", ["a cat", "/cat.png"])).rejects.toThrow(
      "Shared pages are read-only.",
    );
    await expect(bridge.dispatch("doc", "translateFile", ["/a.docx", "de", "/b.docx"])).rejects.toThrow(
      "Shared pages are read-only.",
    );
    await expect(bridge.dispatch("doc", "tools.call", ["search", {}])).rejects.toThrow(
      "wingman.tools is not available",
    );
    await expect(bridge.dispatch("doc", "llm", ["hi"])).rejects.toThrow(
      "wingman.llm is not available on shared pages.",
    );
    await expect(bridge.dispatch("doc", "nope", [])).rejects.toThrow("Unknown wingman method: nope");

    const off = new ShareBridge(manifest({}));
    await expect(off.dispatch("doc", "files.list", [])).rejects.toThrow("wingman.files is not available");
    await expect(off.dispatch("doc", "store.get", ["x"])).rejects.toThrow("wingman.store is not available");
    await expect(off.dispatch("doc", "duckdb.query", [null, "SELECT 1"])).rejects.toThrow(
      "wingman.duckdb is not available",
    );
  });
});

describe("ShareBridge AI helpers", () => {
  it("runs them as the viewer, reading inputs from the share", async () => {
    const bridge = new ShareBridge(
      manifest({ files: true, llm: true, vision: true, ocr: true, translate: true, transcribe: true }),
    );

    expect(await bridge.dispatch("doc", "llm", ["Summarize", { system: "Be brief" }])).toBe("answer: Summarize");
    expect(runLlm).toHaveBeenCalledWith("Summarize", { system: "Be brief" }, { signal: expect.any(AbortSignal) });

    expect(await bridge.dispatch("doc", "vision", ["/chart.png", "What is shown?"])).toBe("a chart");
    expect(runVision).toHaveBeenCalledWith(new TextEncoder().encode("png"), "/chart.png", "What is shown?", {
      signal: expect.any(AbortSignal),
    });

    expect(await bridge.dispatch("doc", "ocr", ["/chart.png"])).toBe("text");
    expect(runOcr).toHaveBeenCalledWith(new TextEncoder().encode("png"), "/chart.png", {
      signal: expect.any(AbortSignal),
    });

    expect(await bridge.dispatch("doc", "translate", ["Hello", "de"])).toBe("Hallo");
    expect(runTranslateText).toHaveBeenCalledWith("de", "Hello", { signal: expect.any(AbortSignal) });

    await expect(bridge.dispatch("doc", "transcribe", ["/missing.mp3"])).rejects.toThrow("File not found");
    expect(runTranscribe).not.toHaveBeenCalled();
  });

  it("cancels a document's calls when the page navigates", async () => {
    vi.mocked(runLlm).mockImplementationOnce(
      (_prompt, _options, request) =>
        new Promise((_, reject) => request?.signal?.addEventListener("abort", () => reject(request.signal?.reason))),
    );
    const bridge = new ShareBridge(manifest({ llm: true, files: true }));

    const pending = bridge.dispatch("doc", "llm", ["long task"]);
    await bridge.dispatch("next-doc", "files.list", []);
    await expect(pending).rejects.toThrow("no longer active");
  });
});

describe("ShareBridge DuckDB", () => {
  it("creates one SQL session per document and mounts the share's data files over HTTP", async () => {
    const hosts: Array<ReturnType<typeof fakeHost>> = [];
    const bridge = new ShareBridge(manifest(), (mount) => {
      const fake = fakeHost(mount);
      hosts.push(fake);
      return fake.host;
    });

    expect(await bridge.dispatch("doc", "files.list", [])).toHaveLength(5);
    expect(hosts).toHaveLength(0);

    expect(await bridge.dispatch("doc", "duckdb.connect", [])).toBe("conn-1");
    await bridge.dispatch("doc", "duckdb.query", ["conn-1", "SELECT ?", [1]]);
    await bridge.dispatch("doc", "duckdb.query", [null, "SELECT 1"]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].query).toHaveBeenNthCalledWith(1, "conn-1", "SELECT ?", [1]);
    expect(hosts[0].query).toHaveBeenNthCalledWith(2, null, "SELECT 1", undefined);

    // The mount registers every queryable file once, under its path and its unique bare name.
    const registerFileURL = vi.fn(async () => {});
    const db = { registerFileURL } as unknown as AsyncDuckDB;
    const registered = new Set<string>();
    await hosts[0].mount(db, registered, new AbortController().signal);
    await hosts[0].mount(db, registered, new AbortController().signal);
    expect([...registered].sort()).toEqual(["data/meta.json", "data/sales.csv", "meta.json", "sales.csv"]);
    expect(registerFileURL).toHaveBeenCalledTimes(4);
    expect(registerFileURL).toHaveBeenCalledWith(
      "sales.csv",
      "https://chat.example.com/artifacts/abc/files/data/sales.csv",
      expect.anything(),
      false,
    );

    // A new document ends the old one's session; the old document can no longer call in.
    await bridge.dispatch("next-doc", "duckdb.files", []);
    expect(hosts).toHaveLength(2);
    expect(hosts[0].dispose).toHaveBeenCalled();
    await expect(bridge.dispatch("doc", "duckdb.query", [null, "SELECT 1"])).rejects.toThrow("no longer active");
  });
});

describe("ShareBridge.attach", () => {
  function message(source: unknown, data: unknown) {
    const channel = new MessageChannel();
    const reply = new Promise<unknown>((resolve) => {
      channel.port1.onmessage = (event) => {
        resolve(event.data);
        channel.port1.close();
      };
    });
    return { event: Object.assign(new Event("message"), { source, data, ports: [channel.port2] }), reply };
  }

  it("answers only its own frame, with the share's token", async () => {
    const target = new EventTarget();
    const page = {} as Window;
    const detach = new ShareBridge(manifest()).attach({ contentWindow: page }, target as Window);
    const rpc = {
      type: "wingman:rpc",
      token: "abc",
      documentId: "doc",
      method: "files.exists",
      params: ["/index.html"],
    };

    const answered = message(page, rpc);
    target.dispatchEvent(answered.event);
    expect(await answered.reply).toEqual({ ok: true, value: true });

    const failed = message(page, { ...rpc, method: "files.remove" });
    target.dispatchEvent(failed.event);
    expect(await failed.reply).toEqual({ ok: false, error: "Shared pages are read-only." });

    for (const [source, data] of [
      [{} as Window, rpc],
      [page, { ...rpc, token: "other" }],
      [page, { ...rpc, type: "other" }],
    ] as const) {
      const ignored = message(source, data);
      target.dispatchEvent(ignored.event);
      expect(
        await Promise.race([ignored.reply, new Promise((resolve) => setTimeout(() => resolve("ignored"), 20))]),
      ).toBe("ignored");
    }

    detach();
    const afterDetach = message(page, rpc);
    target.dispatchEvent(afterDetach.event);
    expect(
      await Promise.race([afterDetach.reply, new Promise((resolve) => setTimeout(() => resolve("ignored"), 20))]),
    ).toBe("ignored");
  });
});

describe("viewer helpers", () => {
  it("builds file URLs with each path segment encoded", () => {
    expect(shareFileUrl("abc", "/reports/q3 final#1.html")).toBe("/artifacts/abc/files/reports/q3%20final%231.html");
  });

  it("opens a page the server redirected to, if it is one of the share's pages", () => {
    const share = { entry: "index.html", files: ["index.html", "docs/guide.html", "data/sales.csv"] };
    expect(initialPage(share, "docs/guide.html")).toBe("docs/guide.html");
    expect(initialPage(share, "data/sales.csv")).toBe("index.html");
    expect(initialPage(share, "missing.html")).toBe("index.html");
    expect(initialPage(share)).toBe("index.html");
  });

  it("labels the expiry, with the year only when it differs", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(expiryLabel("2026-10-30T12:00:00Z", now)).toMatch(/^Expires .*30/);
    expect(expiryLabel("2026-10-30T12:00:00Z", now)).not.toContain("2026");
    expect(expiryLabel("2027-01-05T12:00:00Z", now)).toContain("2027");
    expect(expiryLabel("not a date", now)).toBe("");
  });
});
