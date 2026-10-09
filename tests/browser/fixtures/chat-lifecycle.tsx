import type { ContentPart, ModelMessage, UIMessage } from "@tanstack/ai";
import { testClient } from "../../../src/shared/lib/test-support/ai";
import { memo, StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AgentContext, type AgentContextType } from "../../../src/features/agent/context/AgentContext";
import type { Agent } from "../../../src/features/agent/types/agent";
import { ArtifactsProvider } from "../../../src/features/artifacts/context/ArtifactsProvider";
import { ChatProvider } from "../../../src/features/chat/context/ChatProvider";
import {
  useChat,
  useChatActions,
  useChatList,
  useChatModel,
  useChatRunState,
} from "../../../src/features/chat/hooks/useChat";
import { ChatMessageAttachments } from "../../../src/features/chat/components/ChatMessageAttachments";
import { ChatInterrupts } from "../../../src/features/chat/components/ChatInterrupts";
import { hasStoredAttachments } from "../../../src/features/chat/lib/chatAttachments";
import { storeChat } from "../../../src/features/chat/lib/chatStorage";
import { ProfileContext, type ProfileContextType } from "../../../src/features/settings/context/ProfileContext";
import { ToolsContext, type ToolsContextValue } from "../../../src/features/tools/context/ToolsContext";
import { createSkillsProvider } from "../../../src/features/skills/lib/skillsProvider";
import { loadConfig } from "../../../src/shared/config";
import { flushPersistence } from "../../../src/shared/lib/persistence";
import { fetchModelCatalog } from "../../../src/shared/lib/modelCatalog";
import type { Model } from "../../../src/shared/types/chat";
import { assistantMessage, messageText, userMessage } from "../../../src/shared/lib/messages";
import type { ElicitationResult } from "../../../src/shared/types/elicitation";
import { AppContext, type AppContextType } from "../../../src/shell/context/AppContext";

const loaded = await loadConfig();
if (!loaded) throw new Error("Missing config");
const config = loaded;
let inventory: Model[] = [{ id: "fixture", name: "Fixture", supportedEfforts: ["low", "high"] }];
config.client.listModels = async () => inventory;
config.client.classifyChat = async () => ({ title: "Fixture", categories: [], risks: [] });
const calls: {
  model: string;
  effort?: Model["effort"];
  verbosity?: Model["verbosity"];
  input: ModelMessage[];
  instructions: string;
  tools: string[];
  stream: (text: string) => void;
  finish: (text: string) => void;
  callTool: (name: string, args: object) => void;
  signal?: AbortSignal;
}[] = [];
config.client.textAdapter = (model, signal) =>
  testClient(
    async (options, handler) =>
      new Promise((resolve) => {
        // Deliberately ignore cancellation to exercise late provider events.
        const settings = options.modelOptions as {
          reasoning?: { effort?: Model["effort"] };
          text?: { verbosity?: Model["verbosity"] };
        };
        calls.push({
          model,
          effort: settings.reasoning?.effort,
          verbosity: settings.text?.verbosity,
          input: options.messages,
          instructions: JSON.stringify(options.systemPrompts),
          tools: options.tools?.map((tool) => tool.name) ?? [],
          signal,
          stream: (text) => handler(text),
          finish: (text) => resolve(assistantMessage(text)),
          callTool: (name, args) =>
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
            ),
        });
      }),
  ).textAdapter(model, signal);
const reads: string[] = [];
let heldRead: string | undefined;
let releaseRead: (() => void) | undefined;
const originalGetFile = Object.getOwnPropertyDescriptor(FileSystemFileHandle.prototype, "getFile")!
  .value as FileSystemFileHandle["getFile"];
FileSystemFileHandle.prototype.getFile = async function () {
  const path = (await (await navigator.storage.getDirectory()).resolve(this))?.join("/") ?? "";
  reads.push(path);
  const file = await originalGetFile.call(this);
  if (heldRead === path) {
    heldRead = undefined;
    await new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
  }
  return file;
};
const renders = { list: 0, actions: 0, composer: 0 };
const results: { id: string; result: ElicitationResult }[] = [];
const ListProbe = memo(function ListProbe() {
  const { chats, chatId } = useChatList();
  useEffect(() => {
    renders.list++;
  });
  return (
    <div data-testid="list">
      {chatId}: {chats.map((entry) => entry.title).join(",")}
    </div>
  );
});
const ActionsProbe = memo(function ActionsProbe() {
  const { stopStreaming } = useChatActions();
  useEffect(() => {
    renders.actions++;
  });
  return <button onClick={stopStreaming}>Stop</button>;
});
const ComposerProbe = memo(function ComposerProbe() {
  const { hasMessages } = useChatList();
  const { model } = useChatModel();
  const { isResponding, queuedSends } = useChatRunState();
  useEffect(() => {
    renders.composer++;
  });
  return (
    <div>
      {model?.id}: {hasMessages ? "Reply" : "New"} {isResponding ? "Running" : "Idle"} {queuedSends.length}
    </div>
  );
});
const text = (value: string): UIMessage => userMessage(value);

function Fixture() {
  const chat = useChat();
  window.chatE2E = {
    state: () => ({
      ready: chat.chatsLoaded && !!chat.model,
      chatId: chat.chatId,
      loadedId: chat.chat?.id,
      model: chat.model,
      loading: chat.chatLoading,
      error: chat.chatError,
      chats: chat.chats,
      messages: chat.messages,
      queue: chat.queuedSends,
      pending: chat.pendingElicitation?.toolCallId,
      renders: { ...renders },
      results: [...results],
      reads: [...reads],
      calls: calls.map(({ model, effort, verbosity, input, instructions, tools, signal }) => ({
        model,
        effort,
        verbosity,
        input,
        instructions,
        tools,
        aborted: signal?.aborted,
      })),
    }),
    select: chat.selectChat,
    setModel: chat.setModel,
    refreshModels: async (models: Model[]) => {
      inventory = models;
      await fetchModelCatalog(config, true);
    },
    load: chat.loadChat,
    create: chat.createChat,
    remove: chat.deleteChat,
    send: (message: string) => {
      void chat.sendMessage(text(message));
    },
    stream: (index: number, value: string) => calls[index].stream(value),
    finish: (index: number, value: string) => calls[index].finish(value),
    callTool: (index: number, name: string, args: object) => calls[index].callTool(name, args),
    stop: chat.stopStreaming,
    holdRead: (id: string) => {
      heldRead = `chats/${id}/chat.json`;
      releaseRead = undefined;
    },
    readHeld: () => !!releaseRead,
    releaseRead: () => releaseRead?.(),
    search: async (query: string) => [...(await chat.searchChats(query, new AbortController().signal))],
    ask: (id: string) => {
      void chat
        .requestElicitation(id, "fixture", { message: id, requestedSchema: { type: "object", properties: {} } })
        .then((result) => results.push({ id, result }));
    },
    answer: chat.resolveElicitation,
    seed: async (id: string, parts: ContentPart[]) =>
      storeChat({
        id,
        title: id,
        model: null,
        created: new Date(),
        updated: new Date(),
        messages: [{ ...text(id), parts }],
      }),
    flush: flushPersistence,
    unmount: () => root.unmount(),
  };
  return (
    <>
      <ListProbe />
      <ActionsProbe />
      <ComposerProbe />
      <ChatInterrupts />
      <div data-testid="messages">{chat.messages.map((message) => messageText(message)).join("|")}</div>
      <div style={{ paddingTop: 1500 }}>
        {chat.chat?.messages
          .filter((message) => hasStoredAttachments(message))
          .map((message) => (
            <ChatMessageAttachments key={message.id} message={message}>
              {(loaded) => <div data-testid="attachment">{JSON.stringify(loaded.parts)}</div>}
            </ChatMessageAttachments>
          ))}
      </div>
    </>
  );
}

function AgentOwner({ children }: { children: ReactNode }) {
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  window.setChatAgent = setCurrentAgent;
  return <AgentContext value={{ currentAgent } as AgentContextType}>{children}</AgentContext>;
}

const skills = createSkillsProvider(
  [
    {
      name: "reports",
      plugin: "fixture",
      description: "Build verified reports",
      loadContent: () => "Verify every report against its sources.",
      resources: ["scripts/check.py"],
      loadResource: () => "print('verified')",
    },
  ],
  { id: "fixture-skills", name: "Skills", description: "Fixture" },
)!;

function ToolsOwner({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  window.setChatSkills = setEnabled;
  return (
    <ToolsContext
      value={
        {
          providers: enabled ? [skills] : [],
          coreProviders: [],
          getProviderState: () => "connected",
        } as unknown as ToolsContextValue
      }
    >
      {children}
    </ToolsContext>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <AgentOwner>
      <ProfileContext value={{ generateInstructions: () => "" } as ProfileContextType}>
        <ToolsOwner>
          <AppContext value={{ closeApp: async () => {} } as AppContextType}>
            <ArtifactsProvider>
              <ChatProvider>
                <Fixture />
              </ChatProvider>
            </ArtifactsProvider>
          </AppContext>
        </ToolsOwner>
      </ProfileContext>
    </AgentOwner>
  </StrictMode>,
);

declare global {
  interface Window {
    setChatAgent(agent: Agent | null): void;
    setChatSkills(enabled: boolean): void;
    chatE2E: {
      state(): {
        ready: boolean;
        chatId: string | null;
        loadedId?: string;
        model: Model | null;
        loading: boolean;
        error: string | null;
        chats: import("../../../src/shared/types/chat").ChatEntry[];
        messages: UIMessage[];
        queue: import("@tanstack/ai-client").QueuedMessage[];
        pending?: string;
        renders: typeof renders;
        results: typeof results;
        reads: string[];
        calls: {
          model: string;
          effort?: Model["effort"];
          verbosity?: Model["verbosity"];
          input: ModelMessage[];
          instructions: string;
          tools: string[];
          aborted?: boolean;
        }[];
      };
      select(id: string | null): void;
      setModel(model: Model | null): void;
      refreshModels(models: Model[]): Promise<void>;
      load(id: string): Promise<import("../../../src/shared/types/chat").Chat>;
      create(): Promise<import("../../../src/shared/types/chat").Chat>;
      remove(id: string): void;
      send(message: string): void;
      stream(index: number, value: string): void;
      finish(index: number, value: string): void;
      callTool(index: number, name: string, args: object): void;
      stop(): void;

      holdRead(id: string): void;
      readHeld(): boolean;
      releaseRead(): void;
      search(query: string): Promise<string[]>;
      ask(id: string): void;
      answer(result: ElicitationResult): void;
      seed(id: string, parts: ContentPart[]): Promise<void>;
      flush(): Promise<void>;
      unmount(): void;
    };
  }
}
