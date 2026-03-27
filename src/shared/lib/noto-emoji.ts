import "@fontsource/noto-emoji/300.css";

const READY_CLASS = "noto-emoji-ready";
const FONT_SPEC = '300 1em "Noto Emoji"';

// One representative glyph per @fontsource/noto-emoji unicode-range slice.
const WARMUP_SAMPLES = ["🇺", "🏳️‍🌈", "#️⃣", "⌚", "⚽", "🚗", "🍎", "☀️", "👩‍💻", "😀"];

if (typeof document !== "undefined") {
  const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;

  if (fontSet) {
    void Promise.all(WARMUP_SAMPLES.map((sample) => fontSet.load(FONT_SPEC, sample).catch(() => undefined))).finally(() => {
      document.documentElement.classList.add(READY_CLASS);
    });
  } else {
    document.documentElement.classList.add(READY_CLASS);
  }
}
