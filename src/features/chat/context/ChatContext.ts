import { createContext } from "react";
import type { Chat, Message, Model } from "@/shared/types/chat";
import type { ElicitationResult, PendingElicitation } from "@/shared/types/elicitation";

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
  stopStreaming: () => void;

  // Chat actions
  createChat: () => Promise<Chat>;
  selectChat: (chatId: string | null) => void;
  deleteChat: (chatId: string) => void;
  updateChat: (chatId: string, updater: (chat: Chat) => Partial<Chat>, options?: { preserveDates?: boolean }) => void;

  addMessage: (message: Message) => Promise<void>;
  sendMessage: (message: Message, historyOverride?: Message[]) => Promise<void>;

  // Elicitation state
  pendingElicitation: PendingElicitation | null;
  resolveElicitation: (result: ElicitationResult) => void;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);
