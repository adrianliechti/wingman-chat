import "@fontsource/noto-emoji/emoji-300.css";

export const EMOJI_STORAGE_KEY = "app_emoji";

const READY_CLASS = "noto-emoji-ready";
const NATIVE_CLASS = "emoji-native";
const FONT_SPEC = '300 1em "Noto Emoji"';
const FONT_SAMPLE = "😀";

type EmojiMode = "monochrome" | "native";

const getRootElement = () => {
  if (typeof document === "undefined") {
    return null;
  }

  return document.documentElement;
};

const markNotoEmojiReady = () => {
  const root = getRootElement();
  if (root) {
    root.classList.add(READY_CLASS);
  }
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

export const isNotoEmojiReady = () => {
  const root = getRootElement();
  return root?.classList.contains(READY_CLASS) ?? false;
};

let notoEmojiReadyPromise: Promise<void> | null = null;

export const ensureNotoEmojiReady = (): Promise<void> => {
  if (notoEmojiReadyPromise) {
    return notoEmojiReadyPromise;
  }

  const fontSet = typeof document !== "undefined" ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;

  if (!fontSet) {
    markNotoEmojiReady();
    notoEmojiReadyPromise = Promise.resolve();
    return notoEmojiReadyPromise;
  }

  if (fontSet.check(FONT_SPEC, FONT_SAMPLE)) {
    markNotoEmojiReady();
    notoEmojiReadyPromise = Promise.resolve();
    return notoEmojiReadyPromise;
  }

  notoEmojiReadyPromise = fontSet
    .load(FONT_SPEC, FONT_SAMPLE)
    .catch(() => undefined)
    .then(() => {
      markNotoEmojiReady();
    });

  return notoEmojiReadyPromise;
};

export const prepareInitialEmojiRendering = async () => {
  const emojiMode = getStoredEmojiMode();
  applyEmojiModeClass(emojiMode);

  if (emojiMode === "monochrome") {
    await ensureNotoEmojiReady();
  } else {
    void ensureNotoEmojiReady();
  }
};
