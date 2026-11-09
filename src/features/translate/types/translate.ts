export type TranslationKind = "text" | "file";

/** idle: queued or not started; running: a request is in flight. */
export type TranslationStatus = "idle" | "running" | "done" | "error";

/** A stored document's descriptor; its bytes live in the translation's storage folder. */
export interface StoredFile {
  name: string;
  contentType: string;
  size: number;
}

/**
 * One translation job: a text or a document, translated into one language.
 * Text jobs follow the composer while open; file jobs are created per dropped
 * file and per target language.
 */
export interface Translation {
  id: string;
  kind: TranslationKind;
  created: Date;
  updated: Date;

  /** Platform translator id; "" lets the platform pick its default. */
  provider: string;
  targetLang: string;
  /** "formal" | "informal" | "" (as written). */
  formality: string;
  /** "plain" | "professional" | "natural" | "technical" | "" (as written). */
  style: string;

  /** Text jobs: what the user typed. */
  sourceText: string;
  /** File jobs: the original document. */
  sourceFile?: StoredFile;

  /** The translator's output: the translated text, or a document's text when the translator returns text. */
  translatedText?: string;
  /** Fingerprint of the input that produced `translatedText`, so formality and style changes skip re-translating. */
  translatedKey?: string;
  /** What is shown and copied: `translatedText` after formality, style and refinements. */
  resultText?: string;
  /** File jobs: the translated document, when the translator returns one. */
  resultFile?: StoredFile;

  status: TranslationStatus;
  error?: string;
}
