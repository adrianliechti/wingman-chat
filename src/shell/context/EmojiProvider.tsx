import { useState, useLayoutEffect } from "react";
import type { ReactNode } from "react";
import { EmojiContext } from "./EmojiContext";
import type { EmojiMode, EmojiContextType } from "./EmojiContext";

export function EmojiProvider({ children }: { children: ReactNode }) {
  const [emojiMode, setEmojiMode] = useState<EmojiMode>(() => {
    if (typeof window === "undefined") return "monochrome";
    const stored = localStorage.getItem("app_emoji");
    return stored === "native" ? "native" : "monochrome";
  });

  const handleSetEmojiMode = (mode: EmojiMode) => {
    setEmojiMode(mode);
    if (mode === "monochrome") {
      localStorage.removeItem("app_emoji");
    } else {
      localStorage.setItem("app_emoji", mode);
    }
  };

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("emoji-native", emojiMode === "native");
  }, [emojiMode]);

  const value: EmojiContextType = {
    emojiMode,
    setEmojiMode: handleSetEmojiMode,
  };

  return <EmojiContext.Provider value={value}>{children}</EmojiContext.Provider>;
}
