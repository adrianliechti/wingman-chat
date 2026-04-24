import { createContext } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import type { Chat, Message, Model } from "@/shared/types/chat";
import type { ElicitationResult, PendingElicitation } from "@/shared/types/elicitation";

export interface ChatContextType {
  // Models
  models: Model[];
  model: Model | null; // Current effective model (derived from chat.model || selectedModel || models[0])
  setModel: (model: Model | null) => void;

  // Chats
  chats: Chat[];
  chatsLoaded: boolean;
  chat: Chat | null;
  messages: Message[];
  isResponding: boolean;
  stopStreaming: () => void;

  // Chat actions
  createChat: () => Promise<Chat>;
  selectChat: (chatId: string | null) => void;
  deleteChat: (chatId: string) => void;
  updateChat: (chatId: string, updater: (chat: Chat) => Partial<Chat>, options?: { preserveDates?: boolean }) => void;

  /**
   * Ensure a chat exists and return it along with its filesystem. If a chat
   * is already active, returns it; otherwise creates a new chat. This is the
   * preferred entry point for features (drawer, uploads, terminal) that need
   * a filesystem before the user has sent their first message.
   */
  ensureChat: () => Promise<{ chat: Chat; fs: FileSystemManager }>;

  addMessage: (message: Message) => Promise<void>;
  sendMessage: (message: Message, historyOverride?: Message[]) => Promise<void>;
  retryMessage: () => Promise<void>;
  setVoiceToolCall: (toolName: string | null) => void;

  // Elicitation state
  pendingElicitation: PendingElicitation | null;
  resolveElicitation: (result: ElicitationResult) => void;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);
