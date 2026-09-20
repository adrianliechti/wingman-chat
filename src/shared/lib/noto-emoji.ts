import "@fontsource/noto-emoji/emoji-300.css";

export const EMOJI_STORAGE_KEY = "app_emoji";

const READY_CLASS = "noto-emoji-ready";
const NATIVE_CLASS = "emoji-native";
const FONT_SPEC = '300 1em "Noto Emoji"';
const FONT_SAMPLE = "😀";

export type EmojiMode = "monochrome" | "native";

const getRootElement = () => {
  if (typeof document === "undefined") {
    return null;
  }

  return document.documentElement;
};

export const getStoredEmojiMode = (): EmojiMode => {
  if (typeof window === "undefined") {
    return "monochrome";
  }

  return localStorage.getItem(EMOJI_STORAGE_KEY) === "native" ? "native" : "monochrome";
};

export const persistEmojiMode = (mode: EmojiMode) => {
  if (typeof window === "undefined") {
    return;
  }

  if (mode === "monochrome") {
    localStorage.removeItem(EMOJI_STORAGE_KEY);
    return;
  }

  localStorage.setItem(EMOJI_STORAGE_KEY, mode);
};

export const applyEmojiModeClass = (mode: EmojiMode) => {
  const root = getRootElement();
  if (!root) {
    return;
  }

  root.classList.toggle(NATIVE_CLASS, mode === "native");
};

let notoEmojiReadyPromise: Promise<void> | null = null;

export const ensureNotoEmojiReady = (): Promise<void> => {
  if (notoEmojiReadyPromise) {
    return notoEmojiReadyPromise;
  }

  const fontSet = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fontSet) return Promise.resolve();

  notoEmojiReadyPromise = fontSet
    .load(FONT_SPEC, FONT_SAMPLE)
    .then((fonts) => {
      if (fonts.length > 0) getRootElement()?.classList.add(READY_CLASS);
      else notoEmojiReadyPromise = null;
    })
    .catch(() => {
      // Keep native emoji visible; a later mode change can retry the font.
      notoEmojiReadyPromise = null;
    });

  return notoEmojiReadyPromise;
};

export const prepareInitialEmojiRendering = () => {
  const emojiMode = getStoredEmojiMode();
  applyEmojiModeClass(emojiMode);

  if (emojiMode === "monochrome") void ensureNotoEmojiReady();
};
