import { testClient } from "../../../src/shared/lib/test-support/ai";
import { StrictMode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { PanelShell } from "../../../src/features/chat/components/PanelShell";
import { storeAgent } from "../../../src/features/agent/lib/agentStorage";
import { storeChat } from "../../../src/features/chat/lib/chatStorage";
import { loadConfig } from "../../../src/shared/config";
import { flushPersistence } from "../../../src/shared/lib/persistence";
import { saveSkill } from "../../../src/shared/lib/opfs";
import { savePlugin } from "../../../src/features/plugins/lib/opfs-plugins";
import type { ModelMessage, UIMessage } from "@tanstack/ai";
import { assistantMessage, userMessage } from "../../../src/shared/lib/messages";
import "../../../src/index.css";

const parameters = new URLSearchParams(location.search);
const root = createRoot(document.getElementById("root")!);
const state = {
  effects: 0,
  calls: 0,
  tools: [] as string[],
  instructions: "",
  input: [] as ModelMessage[],
  renders: [] as {
    model: string;
    prompt: string;
    options?: unknown;
    images?: number;
    mask?: number;
    markup?: number;
  }[],
};
let stream = (_text: string) => {};
let think = (_text: string) => {};
let finish = (_text: string) => {};
let fail = () => {};
let callTool = (_name: string, _args: object) => {};
let researchProgress = (_progress: number, _message: string, _total?: number) => {};
let finishResearch = () => {};
window.reactUiE2E = {
  state: () => ({ ...state }),
  stream: (text) => stream(text),
  think: (text) => think(text),
  finish: (text) => finish(text),
  fail: () => fail(),
  callTool: (name, args) => callTool(name, args),
  flush: flushPersistence,
  researchProgress: (progress, message, total) => researchProgress(progress, message, total),
  finishResearch: () => finishResearch(),
};

function PanelContent() {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    state.effects++;
    return () => {
      state.effects--;
    };
  }, []);
  return (
    <>
      <input aria-label="Panel draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      {createPortal(<button type="button">Panel portal</button>, document.body)}
    </>
  );
}

function Panels() {
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState(0);
  return (
    <>
      <div className="relative z-50 flex gap-4">
        <button type="button" onClick={() => setOpen((value) => !value)}>
          Toggle panels
        </button>
        <button type="button" onClick={() => setScope((value) => value + 1)}>
          Change workspace
        </button>
      </div>
      <PanelShell open={open} preserveState compact={false} widthVw={35} offsetVw={40} resizeLabel="Resize draft">
        <PanelContent key={scope} />
      </PanelShell>
      <PanelShell open={open} keepMounted compact={false} widthVw={35} resizeLabel="Resize app">
        <iframe title="Persistent app" srcDoc={'<input aria-label="Frame draft" />'} />
      </PanelShell>
    </>
  );
}

if (parameters.has("panels")) {
  root.render(
    <StrictMode>
      <Panels />
    </StrictMode>,
  );
} else {
  const config = await loadConfig();
  if (!config) throw new Error("Missing fixture config");
  if (parameters.has("composer")) {
    await saveSkill({
      id: "draft-response",
      name: "draft-response",
      description: "Draft a customer reply",
      content: "Follow the customer response template.",
      resources: [
        { path: "references/response.md", content: "Response checklist: acknowledge, explain, resolve." },
        { path: "scripts/check.js", content: '#!/usr/bin/env node\nconsole.log("Selected skill script ran");' },
      ],
    });
    await saveSkill({
      id: "customer-research",
      name: "customer-research",
      description: "Research a customer",
      content: "Gather customer context.",
    });
    await savePlugin({
      id: "support",
      hubUrl: "https://example.test",
      installedAt: "2026-01-01",
      skills: [
        { name: "escalate", description: "Escalate a support case", content: "Follow the escalation procedure." },
      ],
    });
  }
  const model = {
    id: "fixture",
    name: "Fixture",
    ...(parameters.has("research") ? { tools: { enabled: ["internet"], disabled: [] } } : {}),
  };
  if (parameters.has("agent")) {
    await storeAgent({
      id: "mobile-agent",
      name: "Mobile agent",
      model: model.id,
      skills: [],
      plugins: [],
      tools: [],
    });
  }
  if (parameters.has("research")) {
    config.mcps = [
      {
        id: "internet",
        source: "configured",
        name: "Web Search",
        description: "Access up-to-date information",
        url: new URL("/fixture-research-mcp", location.origin).href,
        approval: { mode: "delegated" },
      },
    ];
    // Keep the actual SDK + HTTP stream parser in the fixture, with a tool result
    // released by the test so progress has time to render before completion.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = input instanceof Request ? input.url : input.toString();
      if (!url.endsWith("/fixture-research-mcp")) return response;
      const request = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (request?.method !== "tools/call") return response;
      const result = await response.text();
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            researchProgress = (progress, message, total) =>
              controller.enqueue(
                encoder.encode(
                  `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: request.params._meta.progressToken, progress, message, ...(total === undefined ? {} : { total }) } })}\n\n`,
                ),
              );
            finishResearch = () => {
              controller.enqueue(encoder.encode(`event: message\ndata: ${result}\n\n`));
              controller.close();
            };
            researchProgress(1, "Searching sources");
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  }
  config.client.listModels = async () => [model];
  if (parameters.has("canvas")) {
    // A renderer with known capabilities (aspect tiles, quality tiers) and a
    // synthetic gradient in place of the gateway's image.
    // `vector` swaps in GPT Image 2.6, which can also return SVG and GIF.
    const renderer = parameters.has("video")
      ? { id: "gemini-omni-1.2-flash", name: "Omni", type: "renderer" as const }
      : parameters.has("vector")
        ? { id: "gpt-image-2.6-flare", name: "Flare", type: "renderer" as const }
        : { id: "gpt-image-1", name: "Painter", type: "renderer" as const };
    config.client.listModels = async () => [model, renderer];
    config.client.render = async (rendererModel, prompt, images, options) => {
      // Blobs don't serialize across page.evaluate; record their sizes instead.
      const { mask, markup, ...rest } = options ?? {};
      state.renders.push({
        model: rendererModel,
        prompt,
        options: rest,
        ...(images?.length ? { images: images.length } : {}),
        ...(mask ? { mask: mask.size } : {}),
        ...(markup ? { markup: markup.size } : {}),
      });
      if (options?.format === "mp4") {
        // Real browser media exercises decoding, poster capture, playback and OPFS.
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#1d4ed8";
        context.fillRect(0, 0, 160, 90);
        const stream = canvas.captureStream(10);
        const mimeType = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => chunks.push(event.data);
        const recorded = new Promise<Blob>((resolve) => {
          recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            resolve(new Blob(chunks, { type: "video/mp4" }));
          };
        });
        recorder.start();
        setTimeout(() => recorder.stop(), 300);
        return recorded;
      }
      if (options?.format === "svg") {
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#1d4ed8"/></svg>';
        return new Blob([svg], { type: "image/svg+xml" });
      }
      if (options?.format === "gif") {
        const gif = Uint8Array.from(atob("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="), (c) =>
          c.charCodeAt(0),
        );
        return new Blob([gif], { type: "image/gif" });
      }
      const [width, height] =
        options?.aspectRatio === "3:2" ? [384, 256] : options?.aspectRatio === "2:3" ? [256, 384] : [256, 256];
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#1d4ed8");
      gradient.addColorStop(1, "#f97316");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      return canvas.convertToBlob({ type: "image/png" });
    };
  }
  config.client.generateImage = (...args) => config.client.render(...args);
  config.client.generateTitle = async () => "Fixture";
  config.client.classifyChat = async () => ({ title: "Fixture", categories: [], risks: [] });
  const provider = testClient(
    async (options, handler, onThinking) =>
      new Promise<UIMessage>((resolve, reject) => {
        state.calls++;
        state.tools = options.tools?.map((tool) => tool.name) ?? [];
        state.instructions = JSON.stringify(options.systemPrompts);
        state.input = options.messages;
        stream = (text) => handler?.(text);
        think = onThinking;
        finish = (text) => resolve(assistantMessage(text));
        fail = () => reject(new Error("Fixture response failed"));
        callTool = (name, args) =>
          resolve(
            assistantMessage([
              {
                type: "tool-call",
                id: crypto.randomUUID(),
                name,
                arguments: JSON.stringify(args),
                state: "input-complete",
              },
            ]),
          );
      }),
  );
  config.client.textAdapter = (model, signal) => provider.textAdapter(model, signal);
  if (parameters.has("seed")) {
    for (let index = 0; index < 120; index++) {
      const id = `history-${index}`;
      const answer = index === 119 ? "A long answer.\n\n".repeat(80) : `Answer ${index}`;
      await storeChat({
        id,
        title: `Saved chat ${index}`,
        created: new Date(Date.now() + index * 1000),
        updated: new Date(Date.now() + index * 1000),
        model,
        messages: [
          userMessage(`Question ${index}`, { id: `${id}-user` }),
          assistantMessage(answer, { id: `${id}-answer` }),
        ],
      });
    }
  }
  if (parameters.has("search")) {
    await storeChat({
      id: "search-history",
      title: "Planning notes",
      created: new Date(),
      updated: new Date(),
      model,
      messages: [
        userMessage("Outline the plan", { id: "search-prompt" }),
        assistantMessage(
          `${"Background context.\n\n".repeat(50)}The delivery marker is **violet beacon** for this release.\n\n${"Supporting detail.\n\n".repeat(50)}`,
          { id: "search-answer" },
        ),
        userMessage("Follow the copper compass", { id: "search-followup" }),
        assistantMessage(
          [
            { type: "tool-call", id: "search-tool-1", name: "lookup", arguments: "{}", state: "complete" },
            { type: "tool-result", toolCallId: "search-tool-1", content: "Found", state: "complete" },
            { type: "tool-call", id: "search-tool-2", name: "lookup", arguments: "{}", state: "complete" },
            { type: "tool-result", toolCallId: "search-tool-2", content: "Found", state: "complete" },
          ],
          { id: "search-tools" },
        ),
        assistantMessage("Later discussion.\n\n".repeat(50), { id: "search-latest" }),
      ],
    });
    await storeChat({
      id: "search-title",
      title: "Violet archive",
      created: new Date(),
      updated: new Date(),
      model,
      messages: [userMessage("An unrelated question"), assistantMessage("An unrelated answer")],
    });
  }
  history.replaceState(
    null,
    "",
    parameters.has("seed")
      ? "/chat/history-119"
      : parameters.has("chat")
        ? `/chat/${parameters.get("chat")}`
        : parameters.has("canvas")
          ? "/canvas"
          : "/chat",
  );
  const { default: App } = await import("../../../src/App");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

declare global {
  interface Window {
    reactUiE2E: {
      state(): {
        effects: number;
        calls: number;
        tools: string[];
        instructions: string;
        input: ModelMessage[];
        renders: {
          model: string;
          prompt: string;
          options?: unknown;
          images?: number;
          mask?: number;
          markup?: number;
        }[];
      };
      stream(text: string): void;
      think(text: string): void;
      finish(text: string): void;
      fail(): void;
      callTool(name: string, args: object): void;
      flush(): Promise<void>;
      researchProgress(progress: number, message: string, total?: number): void;
      finishResearch(): void;
    };
  }
}
