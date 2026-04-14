import type { ReactNode } from "react";
import { useRef, useState } from "react";
import {
  applyEmojiModeClass,
  ensureNotoEmojiReady,
  getStoredEmojiMode,
  isNotoEmojiReady,
  persistEmojiMode,
} from "@/shared/lib/noto-emoji";
import type { EmojiContextType, EmojiMode } from "./EmojiContext";
import { EmojiContext } from "./EmojiContext";

export function EmojiProvider({ children }: { children: ReactNode }) {
  const [emojiMode, setEmojiMode] = useState<EmojiMode>(getStoredEmojiMode);
  const requestedEmojiModeRef = useRef<EmojiMode>(emojiMode);

  const handleSetEmojiMode = (mode: EmojiMode) => {
    requestedEmojiModeRef.current = mode;
    setEmojiMode(mode);
    persistEmojiMode(mode);

    if (mode === "native") {
      applyEmojiModeClass(mode);
      return;
    }

    if (isNotoEmojiReady()) {
      applyEmojiModeClass(mode);
      return;
    }

    void ensureNotoEmojiReady().finally(() => {
      if (requestedEmojiModeRef.current === "monochrome") {
        applyEmojiModeClass("monochrome");
      }
    });
  };

  const value: EmojiContextType = {
    emojiMode,
    setEmojiMode: handleSetEmojiMode,
  };

  return <EmojiContext.Provider value={value}>{children}</EmojiContext.Provider>;
}
