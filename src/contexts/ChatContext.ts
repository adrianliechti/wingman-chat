import { createContext } from "react";
import type { Chat, Message, Model, PendingElicitation, ElicitationResult } from "../types/chat";

export interface ChatContextType {
  // Models
  models: Model[];
  model: Model | null; // Current effective model (derived from chat.model || selectedModel || models[0])
  setModel: (model: Model | null) => void;

  // Chats
  chats: Chat[];
  chat: Chat | null;
  messages: Message[];
  isResponding: boolean;

  // Chat actions
  createChat: () => Promise<Chat>;
  selectChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  updateChat: (chatId: string, updater: (chat: Chat) => Partial<Chat>, options?: { preserveDates?: boolean }) => void;

  addMessage: (message: Message) => Promise<void>;
  sendMessage: (message: Message, historyOverride?: Message[]) => Promise<void>;

  // Tool providers state (from global ToolsContext)
  isInitializing: boolean | null; // null = no providers, true = initializing, false = all ready

  // Elicitation state
  pendingElicitation: PendingElicitation | null;
  resolveElicitation: (result: ElicitationResult) => void;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);
