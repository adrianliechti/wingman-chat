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
import { hasStoredAttachments } from "../../../src/features/chat/lib/chatAttachments";
import { storeChat } from "../../../src/features/chat/lib/chatStorage";
import { ProfileContext, type ProfileContextType } from "../../../src/features/settings/context/ProfileContext";
import { ToolsContext, type ToolsContextValue } from "../../../src/features/tools/context/ToolsContext";
import { loadConfig } from "../../../src/shared/config";
import { flushPersistence } from "../../../src/shared/lib/persistence";
import { getModelCatalog } from "../../../src/shared/lib/modelCatalog";
import { type Content, type Message, type Model, getTextFromContent } from "../../../src/shared/types/chat";
import type { ElicitationResult } from "../../../src/shared/types/elicitation";
import { AppContext, type AppContextType } from "../../../src/shell/context/AppContext";

const config = await loadConfig();
if (!config) throw new Error("Missing config");
let inventory: Model[] = [{ id: "fixture", name: "Fixture", supportedEfforts: ["low", "high"] }];
config.client.listModels = async () => inventory;
const catalog = getModelCatalog(config);
config.client.classifyChat = async () => ({ title: "Fixture", categories: [], risks: [] });
const calls: {
  model: string;
  effort?: Model["effort"];
  verbosity?: Model["verbosity"];
  input: Message[];
  stream: (text: string) => void;
  finish: (text: string) => void;
  signal?: AbortSignal;
}[] = [];
config.client.complete = async (model, _instructions, input, _tools, handler, options) =>
  new Promise((resolve) => {
    // Deliberately ignore cancellation in this fake service to exercise late callbacks.
    calls.push({
      model,
      effort: options?.effort,
      verbosity: options?.verbosity,
      input,
      signal: options?.signal,
      stream: (text) => handler?.([{ type: "text", text }]),
      finish: (text) => resolve({ role: "assistant", content: [{ type: "text", text }] }),
    });
  });
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
const text = (value: string): Message => ({ role: "user", content: [{ type: "text", text: value }] });

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
      calls: calls.map(({ model, effort, verbosity, input, signal }) => ({
        model,
        effort,
        verbosity,
        input,
        aborted: signal?.aborted,
      })),
    }),
    select: chat.selectChat,
    setModel: chat.setModel,
    refreshModels: async (models: Model[]) => {
      inventory = models;
      await catalog.refresh(true);
    },
    load: chat.loadChat,
    create: chat.createChat,
    remove: chat.deleteChat,
    send: (message: string) => {
      void chat.sendMessage(text(message));
    },
    stream: (index: number, value: string) => calls[index].stream(value),
    finish: (index: number, value: string) => calls[index].finish(value),
    stop: chat.stopStreaming,
    sendHeld: (id: string) => {
      void chat.sendHeldMessage(id);
    },
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
    seed: async (id: string, content: Content[]) =>
      storeChat({
        id,
        title: id,
        model: null,
        created: new Date(),
        updated: new Date(),
        messages: [{ ...text(id), content }],
      }),
    flush: flushPersistence,
    unmount: () => root.unmount(),
  };
  return (
    <>
      <ListProbe />
      <ActionsProbe />
      <ComposerProbe />
      <div data-testid="messages">{chat.messages.map((message) => getTextFromContent(message.content)).join("|")}</div>
      <div style={{ paddingTop: 1500 }}>
        {chat.chat?.messages
          .filter((message) => hasStoredAttachments(message.content))
          .map((message) => (
            <ChatMessageAttachments key={message.id} message={message}>
              {(loaded) => <div data-testid="attachment">{JSON.stringify(loaded.content)}</div>}
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

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <AgentOwner>
      <ProfileContext value={{ generateInstructions: () => "" } as ProfileContextType}>
        <ToolsContext value={{ providers: [], coreProviders: [] } as unknown as ToolsContextValue}>
          <AppContext value={{ closeApp: async () => {} } as AppContextType}>
            <ArtifactsProvider>
              <ChatProvider>
                <Fixture />
              </ChatProvider>
            </ArtifactsProvider>
          </AppContext>
        </ToolsContext>
      </ProfileContext>
    </AgentOwner>
  </StrictMode>,
);

declare global {
  interface Window {
    setChatAgent(agent: Agent | null): void;
    chatE2E: {
      state(): {
        ready: boolean;
        chatId: string | null;
        loadedId?: string;
        model: Model | null;
        loading: boolean;
        error: string | null;
        chats: import("../../../src/shared/types/chat").ChatEntry[];
        messages: Message[];
        queue: import("../../../src/features/chat/lib/chatQueue").QueuedSend[];
        pending?: string;
        renders: typeof renders;
        results: typeof results;
        reads: string[];
        calls: {
          model: string;
          effort?: Model["effort"];
          verbosity?: Model["verbosity"];
          input: Message[];
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
      stop(): void;
      sendHeld(id: string): void;
      holdRead(id: string): void;
      readHeld(): boolean;
      releaseRead(): void;
      search(query: string): Promise<string[]>;
      ask(id: string): void;
      answer(result: ElicitationResult): void;
      seed(id: string, content: Content[]): Promise<void>;
      flush(): Promise<void>;
      unmount(): void;
    };
  }
}
