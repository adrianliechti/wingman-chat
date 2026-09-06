import type { Client } from "@/shared/lib/client";
import { downloadFromUrl, formatBytes } from "@/shared/lib/utils";

interface TranslationInput {
  sourceText: string;
  targetLang: string;
  tone: string;
  style: string;
  selectedFile: File | null;
}

interface TranslationState extends TranslationInput {
  translatedText: string;
  translatedFileUrl: string | null;
  translatedFileName: string | null;
  isLoading: boolean;
  error: string | null;
}

interface TranslationOptions {
  model?: string;
  maxFileSize?: number;
  maxTextLength?: number;
}

const emptyResult = {
  translatedText: "",
  translatedFileUrl: null,
  translatedFileName: null,
  isLoading: false,
  error: null,
};

/** Owns the debounce, request, and download URL for one translation workspace. */
export class TranslationSession {
  private readonly client: Pick<Client, "translate" | "rewriteText">;
  private readonly options: TranslationOptions;
  private state: TranslationState = {
    sourceText: "",
    targetLang: "en",
    tone: "",
    style: "",
    selectedFile: null,
    ...emptyResult,
  };
  private readonly listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private request?: { controller: AbortController; key: string; file: File | null; promise: Promise<void> };
  private completed?: { key: string; file: File | null };

  constructor(client: Pick<Client, "translate" | "rewriteText">, options: TranslationOptions = {}) {
    this.client = client;
    this.options = options;
  }

  getSnapshot = (): TranslationState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(patch: Partial<TranslationState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.request?.controller.abort();
    this.request = undefined;
  }

  private releaseDownload(): void {
    if (this.state.translatedFileUrl) URL.revokeObjectURL(this.state.translatedFileUrl);
  }

  update = (patch: Partial<TranslationInput>): void => {
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof TranslationInput] === value)) return;
    this.cancel();
    this.releaseDownload();
    this.completed = undefined;
    this.publish({ ...patch, ...emptyResult });
    if (this.state.sourceText.trim() && !this.state.selectedFile) {
      this.timer = setTimeout(() => {
        void this.translate();
      }, 1000);
    }
  };

  reset = (): void => {
    this.cancel();
    this.releaseDownload();
    this.completed = undefined;
    this.publish({ sourceText: "", selectedFile: null, ...emptyResult });
  };

  dispose = (): void => {
    this.cancel();
    this.releaseDownload();
    this.completed = undefined;
    this.publish(emptyResult);
  };

  translate = (): Promise<void> => {
    const input = this.state;
    const key = JSON.stringify([input.sourceText, input.targetLang, input.tone, input.style]);
    const file = input.selectedFile;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.request?.key === key && this.request.file === file) return this.request.promise;
    if (this.completed?.key === key && this.completed.file === file) return Promise.resolve();
    this.cancel();
    this.releaseDownload();
    this.completed = undefined;
    this.publish(emptyResult);

    const { maxFileSize, maxTextLength } = this.options;
    if (file && maxFileSize != null && file.size > maxFileSize) {
      this.publish({
        error: `"${file.name}" is ${formatBytes(file.size)}, over the ${formatBytes(maxFileSize)} limit.`,
      });
      return Promise.resolve();
    }
    if (!file && !input.sourceText.trim()) return Promise.resolve();
    if (!file && maxTextLength != null && input.sourceText.length > maxTextLength) {
      this.publish({
        error: `Text is ${input.sourceText.length.toLocaleString()} characters, over the ${maxTextLength.toLocaleString()} limit.`,
      });
      return Promise.resolve();
    }

    const controller = new AbortController();
    const { signal } = controller;
    // Start in a microtask so ownership exists even if a client throws synchronously.
    const promise = Promise.resolve().then(async () => {
      try {
        signal.throwIfAborted();
        let result = await this.client.translate(input.targetLang, file ?? input.sourceText, { signal });
        signal.throwIfAborted();
        if (typeof result === "string") {
          if (!file && (input.tone || input.style)) {
            result = await this.client.rewriteText(
              this.options.model ?? "",
              result,
              input.targetLang,
              input.tone,
              input.style,
              undefined,
              { signal },
            );
            signal.throwIfAborted();
          }
          this.completed = { key, file };
          this.publish({ translatedText: result });
        } else if (file) {
          const dot = file.name.lastIndexOf(".");
          const name = `${dot < 0 ? file.name : file.name.slice(0, dot)}_${input.targetLang}${dot < 0 ? "" : file.name.slice(dot)}`;
          const url = URL.createObjectURL(result);
          this.completed = { key, file };
          this.publish({ translatedFileUrl: url, translatedFileName: name });
          if (!signal.aborted) downloadFromUrl(url, name);
        }
      } catch (error) {
        if (!signal.aborted) this.publish({ error: error instanceof Error ? error.message : "Translation failed." });
      } finally {
        if (this.request?.controller === controller) {
          this.request = undefined;
          this.publish({ isLoading: false });
        }
      }
    });
    this.request = { controller, key, file, promise };
    this.publish({ isLoading: true });
    return promise;
  };
}
