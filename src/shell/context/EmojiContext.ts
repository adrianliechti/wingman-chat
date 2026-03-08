import { createContext } from 'react';

export type EmojiMode = 'monochrome' | 'native';

export type EmojiContextType = {
  emojiMode: EmojiMode;
  setEmojiMode: (mode: EmojiMode) => void;
};

export const EmojiContext = createContext<EmojiContextType | undefined>(undefined);
