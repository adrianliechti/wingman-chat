import { testClient } from "../../../src/shared/lib/test-support/ai";
import { StrictMode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { PanelShell } from "../../../src/features/chat/components/PanelShell";
import { storeChat } from "../../../src/features/chat/lib/chatStorage";
import { loadConfig } from "../../../src/shared/config";
import { flushPersistence } from "../../../src/shared/lib/persistence";
import type { Content, Message } from "../../../src/shared/types/chat";
import "../../../src/index.css";

const parameters = new URLSearchParams(location.search);
const root = createRoot(document.getElementById("root")!);
const state = { effects: 0, calls: 0 };
let stream = (_text: string) => {};
let finish = (_text: string) => {};
let callTool = (_name: string, _args: object) => {};
window.reactUiE2E = {
  state: () => ({ ...state }),
  stream: (text) => stream(text),
  finish: (text) => finish(text),
  callTool: (name, args) => callTool(name, args),
  flush: flushPersistence,
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
  const model = {
    id: "fixture",
    name: "Fixture",
    ...(parameters.has("research") ? { tools: { enabled: ["internet"], disabled: [] } } : {}),
  };
  if (parameters.has("research")) {
    config.internet = { searcher: "fixture", elicitation: true };
    config.client.guard = async () => ({ flagged: false, categories: [] });
    config.client.search = async () => [
      { title: "Source", source: "https://example.com", content: "Research evidence" },
    ];
  }
  config.client.listModels = async () => [model];
  config.client.classifyChat = async () => ({ title: "Fixture", categories: [], risks: [] });
  const provider = testClient(
    async (_options, handler) =>
      new Promise<Message>((resolve) => {
        state.calls++;
        stream = (text) => handler?.([{ type: "text", text }]);
        finish = (text) => resolve({ role: "assistant", content: [{ type: "text", text }] });
        callTool = (name, args) =>
          resolve({
            role: "assistant",
            content: [{ type: "tool_call", id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }],
          });
      }),
  );
  config.client.textAdapter = (model, signal) => provider.textAdapter(model, signal);
  if (parameters.has("seed")) {
    for (let index = 0; index < 120; index++) {
      const id = `history-${index}`;
      const text: Content[] = [
        { type: "text", text: index === 119 ? "A long answer.\n\n".repeat(80) : `Answer ${index}` },
      ];
      await storeChat({
        id,
        title: `Saved chat ${index}`,
        created: new Date(Date.now() + index * 1000),
        updated: new Date(Date.now() + index * 1000),
        model,
        messages: [
          { id: `${id}-user`, role: "user", content: [{ type: "text", text: `Question ${index}` }] },
          { id: `${id}-answer`, role: "assistant", content: text },
        ],
      });
    }
  }
  history.replaceState(null, "", parameters.has("seed") ? "/chat/history-119" : "/chat");
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
      state(): { effects: number; calls: number };
      stream(text: string): void;
      finish(text: string): void;
      callTool(name: string, args: object): void;
      flush(): Promise<void>;
    };
  }
}
