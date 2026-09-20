import { createContext } from "react";
import type { EmojiMode } from "@/shared/lib/noto-emoji";

export type { EmojiMode } from "@/shared/lib/noto-emoji";

export type EmojiContextType = {
  emojiMode: EmojiMode;
  setEmojiMode: (mode: EmojiMode) => void;
};

export const EmojiContext = createContext<EmojiContextType | undefined>(undefined);
