import { createContext } from "react";
import type { Chat, Message, Model, Tool } from "../types/chat";

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
  createChat: () => Chat;
  selectChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  updateChat: (chatId: string, updater: (chat: Chat) => Partial<Chat>) => void;

  addMessage: (message: Message) => void;
  sendMessage: (message: Message, tools?: Tool[]) => Promise<void>;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);
