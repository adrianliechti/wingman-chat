import type { ReactNode } from "react";
import { useState } from "react";
import {
  applyEmojiModeClass,
  ensureNotoEmojiReady,
  getStoredEmojiMode,
  persistEmojiMode,
} from "@/shared/lib/noto-emoji";
import type { EmojiContextType, EmojiMode } from "./EmojiContext";
import { EmojiContext } from "./EmojiContext";

export function EmojiProvider({ children }: { children: ReactNode }) {
  const [emojiMode, setEmojiMode] = useState<EmojiMode>(getStoredEmojiMode);

  const handleSetEmojiMode = (mode: EmojiMode) => {
    setEmojiMode(mode);
    persistEmojiMode(mode);

    applyEmojiModeClass(mode);
    if (mode === "monochrome") void ensureNotoEmojiReady();
  };

  const value: EmojiContextType = {
    emojiMode,
    setEmojiMode: handleSetEmojiMode,
  };

  return <EmojiContext value={value}>{children}</EmojiContext>;
}
