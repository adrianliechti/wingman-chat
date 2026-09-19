import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { AgentContext, type AgentContextType } from "../../../src/features/agent/context/AgentContext";
import { ArtifactsDrawer } from "../../../src/features/artifacts/components/ArtifactsDrawer";
import { ArtifactsProvider } from "../../../src/features/artifacts/context/ArtifactsProvider";
import { useArtifacts } from "../../../src/features/artifacts/hooks/useArtifacts";
import { useArtifactsProvider } from "../../../src/features/artifacts/hooks/useArtifactsProvider";
import { FileSystemManager } from "../../../src/features/artifacts/lib/fs";
import { ChatProvider } from "../../../src/features/chat/context/ChatProvider";
import { useChat } from "../../../src/features/chat/hooks/useChat";
import { ProfileContext, type ProfileContextType } from "../../../src/features/settings/context/ProfileContext";
import { ToolsContext, type ToolsContextValue } from "../../../src/features/tools/context/ToolsContext";
import { loadConfig } from "../../../src/shared/config";
import type { File } from "../../../src/shared/types/file";
import { AppContext, type AppContextType } from "../../../src/shell/context/AppContext";
import { ThemeProvider } from "../../../src/shell/context/ThemeProvider";
import type { Content, Tool } from "../../../src/shared/types/chat";

const config = await loadConfig();
if (!config) throw new Error("Missing fixture config");
const model = { id: "fixture", name: "Fixture" };
config.client.listModels = async () => [model];
config.client.complete = async () => ({ role: "assistant", content: [{ type: "text", text: "Done" }] });
config.client.classifyChat = async () => ({ title: "Fixture", categories: [], risks: [] });

const releaseReads: Array<() => void> = [];
let readHeld = false;
let releaseUpload: (() => void) | undefined;
let uploadHeld = false;
let releaseChatSave: (() => void) | undefined;
let chatSaveHeld = false;

function Fixture() {
  const artifacts = useArtifacts();
  const chat = useChat();
  const provider = useArtifactsProvider();
  window.artifactsE2E = {
    state: () => ({
      ready: chat.chatsLoaded && !!chat.model,
      chatId: chat.chat?.id ?? null,
      fsChatId: artifacts.fs?.chatId ?? null,
      chats: chat.chats.map((item) => item.id),
      messages: chat.messages.length,
      activeFile: artifacts.activeFile,
      drawer: artifacts.showArtifactsDrawer,
      runtimeContext: provider?.runtimeContext,
    }),
    ensureChat: async () => (await chat.ensureChat()).chat.id,
    createChat: async () => (await chat.createChat()).id,
    selectChat: chat.selectChat,
    deleteChat: chat.deleteChat,
    send: () => chat.sendMessage({ role: "user", content: [{ type: "text", text: "Hello" }] }),
    lastUserMessage: () =>
      chat.messages.findLast((item) => item.role === "user" && item.content.some((part) => part.type === "text"))
        ?.content,
    openFile: artifacts.openFile,
    showDrawer: artifacts.setShowArtifactsDrawer,
    async write(chatId, path, content) {
      await new FileSystemManager(chatId).createFile(path, content);
    },
    async remove(chatId, path) {
      await new FileSystemManager(chatId).deleteFile(path);
    },
    async rename(chatId, from, to) {
      await new FileSystemManager(chatId).renameFile(from, to);
    },
    read: (chatId, path) => new FileSystemManager(chatId).getFile(path),
    async tool(name, args, chatId) {
      const tool = provider!.tools.find((item: Tool) => item.name === name)!;
      return tool.function(args, { chatId });
    },
    // Hold one already-read snapshot while later filesystem reads continue.
    // This makes navigation and out-of-order refresh races deterministic.
    holdNextRead(chatId = artifacts.fs!.chatId) {
      readHeld = false;
      const read = Object.getOwnPropertyDescriptor(FileSystemManager.prototype, "getFile")!
        .value as FileSystemManager["getFile"];
      const gate = new Promise<void>((resolve) => {
        releaseReads.push(resolve);
      });
      FileSystemManager.prototype.getFile = async function (path: string) {
        if (this.chatId !== chatId) return read.call(this, path);
        FileSystemManager.prototype.getFile = read;
        const file = await read.call(this, path);
        readHeld = true;
        await gate;
        return file;
      };
    },
    readHeld: () => readHeld,
    async releaseRead() {
      releaseReads.shift()?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    holdUpload() {
      uploadHeld = false;
      const read = Object.getOwnPropertyDescriptor(Blob.prototype, "arrayBuffer")!.value as Blob["arrayBuffer"];
      globalThis.File.prototype.arrayBuffer = async function () {
        Reflect.deleteProperty(globalThis.File.prototype, "arrayBuffer");
        uploadHeld = true;
        await new Promise<void>((resolve) => {
          releaseUpload = resolve;
        });
        return read.call(this);
      };
    },
    uploadHeld: () => uploadHeld,
    releaseUpload: () => releaseUpload?.(),
    holdChatSave() {
      chatSaveHeld = false;
      const existing = new Set(chat.chats.map((item) => item.id));
      const create = Object.getOwnPropertyDescriptor(FileSystemFileHandle.prototype, "createWritable")!
        .value as FileSystemFileHandle["createWritable"];
      FileSystemFileHandle.prototype.createWritable = async function (options) {
        const path = await (await navigator.storage.getDirectory()).resolve(this);
        if (this.name === "chat.json" && path?.[0] === "chats" && !existing.has(path[1])) {
          FileSystemFileHandle.prototype.createWritable = create;
          chatSaveHeld = true;
          await new Promise<void>((resolve) => {
            releaseChatSave = resolve;
          });
        }
        return create.call(this, options);
      };
    },
    chatSaveHeld: () => chatSaveHeld,
    releaseChatSave: () => releaseChatSave?.(),
  };

  return (
    <main style={{ height: "100vh" }}>
      <button type="button" onClick={artifacts.toggleArtifactsDrawer}>
        Toggle artifacts
      </button>
      <div style={{ height: "calc(100vh - 32px)" }}>{artifacts.showArtifactsDrawer && <ArtifactsDrawer />}</div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AgentContext value={{ currentAgent: null } as AgentContextType}>
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
      </AgentContext>
    </ThemeProvider>
  </StrictMode>,
);

declare global {
  interface Window {
    artifactsE2E: {
      state(): {
        ready: boolean;
        chatId: string | null;
        fsChatId: string | null;
        chats: string[];
        messages: number;
        activeFile: string | null;
        drawer: boolean;
        runtimeContext?: string;
      };
      ensureChat(): Promise<string>;
      createChat(): Promise<string>;
      selectChat(id: string | null): void;
      deleteChat(id: string): void;
      send(): Promise<void>;
      lastUserMessage(): Content[] | undefined;
      openFile(path: string, fs?: FileSystemManager): void;
      showDrawer(show: boolean): void;
      write(chatId: string, path: string, content: string): Promise<void>;
      remove(chatId: string, path: string): Promise<void>;
      rename(chatId: string, from: string, to: string): Promise<void>;
      read(chatId: string, path: string): Promise<File | undefined>;
      tool(name: string, args: Record<string, unknown>, chatId: string): Promise<unknown>;
      holdNextRead(chatId?: string): void;
      readHeld(): boolean;
      releaseRead(): Promise<void>;
      holdUpload(): void;
      uploadHeld(): boolean;
      releaseUpload(): void;
      holdChatSave(): void;
      chatSaveHeld(): boolean;
      releaseChatSave(): void;
    };
  }
}
