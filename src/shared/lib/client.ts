import { playAudioBlob } from "./audioPlayback";
import mime from "mime";
import { chat, embed, generateSpeech, generateTranscription } from "@tanstack/ai";
import { z } from "zod";
import instructionsConvertCsv from "@/features/chat/prompts/convert-csv.txt?raw";
import instructionsConvertMd from "@/features/chat/prompts/convert-md.txt?raw";
import instructionsRewriteSelection from "@/features/chat/prompts/rewrite-selection.txt?raw";
import instructionsRewriteText from "@/features/chat/prompts/rewrite-text.txt?raw";
import instructionsTitleChat from "@/features/chat/prompts/chat-title.txt?raw";
import { sanitizeForClassification } from "@/features/chat/lib/chatHistory";
import {
  type ClassificationItem,
  type ClassificationMatch,
  classificationMatches,
  classificationRequest,
} from "@/features/chat/lib/classificationQuestions";
import type { SearchResult } from "@/features/research/types/search";
import instructionsOptimizeSkill from "@/prompts/skill-optimizer.txt?raw";
import type { ImageQuality, Message, Model, ModelType, ReasoningEffort } from "@/shared/types/chat";
import type { AgentContext } from "@/shared/types/telemetry";
import { combineAbortSignals } from "./abortSignals";
import { type Embedding, validateEmbeddingVector } from "./embeddings";
import { modelFromAPI, modelMaxOutputTokens, outputTokenAllowance } from "./models";
import { aiTelemetry } from "./otel";
import { aiDebug } from "./aiStream";
import {
  browserProviderConfig,
  gatewayEmbedding,
  gatewaySpeech,
  gatewayText,
  gatewayTranscription,
} from "./aiProvider";
import { decodeBase64, simplifyMarkdown } from "./utils";

function expandToSentences(text: string, start: number, end: number): string {
  const sentenceBoundaries = /[.!?]+\s*|\n+/g;
  const boundaries: number[] = [0];
  let match = sentenceBoundaries.exec(text);
  while (match !== null) {
    boundaries.push(match.index + match[0].length);
    match = sentenceBoundaries.exec(text);
  }
  boundaries.push(text.length);

  let sentenceStart = -1;
  let sentenceEnd = -1;
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (boundaries[i] < end && boundaries[i + 1] > start) {
      sentenceStart = sentenceStart === -1 ? boundaries[i] : Math.min(sentenceStart, boundaries[i]);
      sentenceEnd = sentenceEnd === -1 ? boundaries[i + 1] : Math.max(sentenceEnd, boundaries[i + 1]);
    }
  }
  if (sentenceStart === -1) return text.substring(start, end).trim();
  return text.substring(sentenceStart, sentenceEnd).trim();
}

// mime.getExtension is lossy for audio containers — it maps audio/webm to
// ".weba" and audio/ogg to ".oga", neither of which the transcription endpoint
// accepts (it allows mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm, flac). Map the
// types we send to an accepted extension before falling back to mime.
const TRANSCRIBE_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/**
 * Optional geometry/quality knobs for image generation, forwarded to the
 * backend's `/v1/render`. All are provider-neutral: the backend maps each to the
 * target model's supported values (aspect ratios snap to the nearest available)
 * and silently drops what a model can't honor, so the same options work across
 * providers.
 */
export interface ImageRenderOptions {
  /** Aspect ratio like "1:1" or "16:9"; snapped to the nearest the model supports. */
  aspectRatio?: string;
  /** Quality tier; higher is slower and may cost more. */
  quality?: ImageQuality;
  /** Output resolution. */
  resolution?: "512" | "1K" | "2K" | "4K";
  /** Background handling (only honored by models that support it). */
  background?: "transparent" | "opaque";
  /** Desired output format; negotiated via the `Accept` header, not a form field. */
  format?: "png" | "jpeg" | "webp";
}

/** Trace and cancellation context shared by every cancellable client request. */
export interface ClientRequestOptions {
  signal?: AbortSignal;
  parentContext?: AgentContext;
}

export interface GuardResult {
  flagged: boolean;
  categories: Array<{ name: string; score: number }>;
}

export interface ParseOptions extends ClientRequestOptions {
  effort?: ReasoningEffort;
  maxOutputTokens?: number;
}

/**
 * Best-effort human-readable detail from a failed response body, so tool errors
 * surface the backend's reason instead of a bare status code. Handles both
 * plain-text errors (e.g. /api/v1/render) and `{ error: { message } }` /
 * `{ error }` JSON envelopes, truncated so a stray HTML error page can't flood
 * the message.
 */
async function readErrorBody(resp: Response): Promise<string> {
  let text: string;
  try {
    text = (await resp.text()).trim();
  } catch {
    return "";
  }
  if (!text) return "";

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const body = JSON.parse(text);
      const message = body?.error?.message ?? body?.error ?? body?.message;
      if (typeof message === "string" && message.trim()) text = message.trim();
    } catch {
      // Not JSON after all — fall back to the raw text.
    }
  }

  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export class Client {
  private readonly apiKey: string;
  private readonly modelOverrides: Map<string, Pick<Model, "id" | "maxOutputTokens" | "outputTokenBudget">>;
  private modelInfo: Model[] = [];

  constructor(apiKey: string = "sk-", models: Pick<Model, "id" | "maxOutputTokens" | "outputTokenBudget">[] = []) {
    this.modelOverrides = new Map(models.map((model) => [model.id, model]));
    this.apiKey = apiKey;
  }

  textAdapter(model: string, signal?: AbortSignal) {
    return gatewayText(model, this.apiKey, browserProviderConfig(signal));
  }

  async listModels(type?: ModelType): Promise<Model[]> {
    const response = await fetch(new URL("/api/v1/models", window.location.origin), {
      signal: AbortSignal.timeout(15_000),
      headers: { "Cache-Control": "no-cache", Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) throw new Error(`Failed to list models: ${response.status}`);
    const models = await response.json();
    const mappedModels = (models.data as Parameters<typeof modelFromAPI>[0][]).map(modelFromAPI);
    this.modelInfo = mappedModels;

    if (type) {
      return mappedModels.filter((model) => model.type === type);
    }

    return mappedModels;
  }

  // Lists the MCP servers the backend currently exposes (RBAC-filtered). The
  // OpenAI SDK has no helper for this endpoint, so we hit `/v1/mcp` directly
  // (same `{ object: "list", data: [...] }` shape as `/v1/models`).
  async listMCPs(): Promise<string[]> {
    const resp = await fetch(new URL("/api/v1/mcp", window.location.origin));

    if (!resp.ok) {
      throw new Error(`failed to list mcps: ${resp.status}`);
    }

    const body = await resp.json();

    if (!Array.isArray(body?.data)) {
      return [];
    }

    return body.data.map((mcp: { id: string }) => mcp.id);
  }

  chatModelOptions(
    model: string,
    options?: {
      effort?: ReasoningEffort;
      summary?: "auto" | "concise" | "detailed";
      verbosity?: "low" | "medium" | "high";
      maxOutputTokens?: number;
    },
  ) {
    const maxOutputTokens = this.outputTokenBudget(
      model,
      options?.maxOutputTokens ?? this.modelOverrides.get(model)?.outputTokenBudget,
    );
    return {
      store: false,
      include: ["reasoning.encrypted_content" as const],
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
      ...(options?.effort || options?.summary
        ? { reasoning: { effort: options.effort, summary: options.summary } }
        : {}),
      ...(options?.verbosity ? { text: { verbosity: options.verbosity } } : {}),
    };
  }

  async generateTitle(model: string, input: Message[], options: ParseOptions = {}): Promise<string | null> {
    const history = sanitizeForClassification(input);
    const result = await this.parse(
      model,
      instructionsTitleChat,
      JSON.stringify({ history }),
      z.object({ title: z.string().describe("Short, descriptive title. Less than 10 words, no quotes.") }).strict(),
      "title_chat",
      options,
    );
    return result?.title || null;
  }

  /** Classifies the latest user message into categories and risks with one System One request. */
  async classifyChat(
    model: string,
    input: Message[],
    categories: ClassificationItem[] = [],
    risks: ClassificationItem[] = [],
    requestOptions: ClientRequestOptions & Pick<ParseOptions, "effort"> = {},
  ): Promise<{ categories: ClassificationMatch[]; risks: ClassificationMatch[] }> {
    const request = classificationRequest(input, categories, risks);
    if (!request) return { categories: [], risks: [] };
    const result = await this.postRaw(
      "/api/v1/systemone",
      JSON.stringify({ model, ...request, effort: requestOptions.effort }),
      (resp) => resp.json(),
      { "Content-Type": "application/json" },
      30_000,
      requestOptions,
    );
    return classificationMatches(result?.answers, categories, risks);
  }

  async convertCSV(model: string, text: string): Promise<string> {
    if (!text.trim()) return "";
    const result = await this.parse(
      model,
      instructionsConvertCsv,
      text,
      z.object({ csvData: z.string() }).strict(),
      "convert_csv",
    );
    return result?.csvData ?? "";
  }

  async convertMD(model: string, text: string): Promise<string> {
    if (!text.trim()) return "";
    const result = await this.parse(
      model,
      instructionsConvertMd,
      text,
      z.object({ mdData: z.string() }).strict(),
      "convert_md",
    );
    return result?.mdData ?? "";
  }

  async rewriteSelection(
    model: string,
    text: string,
    selectionStart: number,
    selectionEnd: number,
  ): Promise<{ alternatives: string[]; contextToReplace: string; keyChanges: string[] }> {
    const empty = {
      alternatives: [] as string[],
      contextToReplace: text.substring(selectionStart, selectionEnd),
      keyChanges: [] as string[],
    };
    if (!text.trim() || selectionStart < 0 || selectionEnd <= selectionStart || selectionStart >= text.length)
      return empty;

    const contextToRewrite = expandToSentences(text, selectionStart, selectionEnd);
    const selectedText = text.substring(selectionStart, selectionEnd);
    const result = await this.parse(
      model,
      instructionsRewriteSelection,
      JSON.stringify({ context: contextToRewrite, selection: selectedText }),
      z
        .object({
          alternatives: z
            .array(z.object({ text: z.string(), keyChange: z.string() }).strict())
            .min(3)
            .max(6),
        })
        .strict(),
      "rewrite_selection",
    );

    return {
      alternatives: result?.alternatives.map((a) => a.text) ?? [],
      contextToReplace: contextToRewrite,
      keyChanges: result?.alternatives.map((a) => a.keyChange) ?? [],
    };
  }

  async extractText(blob: Blob, requestOptions: ClientRequestOptions = {}): Promise<string> {
    return this.post("/api/v1/extract", { file: blob, format: "text" }, (resp) => resp.text(), requestOptions);
  }

  async scrape(model: string, url: string, requestOptions: ClientRequestOptions = {}): Promise<string> {
    return this.post(
      "/api/v1/extract",
      { ...(model && { model }), url, format: "text" },
      (resp) => resp.text(),
      requestOptions,
    );
  }

  async segmentText(text: string, requestOptions: ClientRequestOptions = {}): Promise<string[]> {
    const result = await this.post("/api/v1/segment", { text }, (resp) => resp.json(), requestOptions);
    if (!Array.isArray(result)) throw new Error("The segmentation service returned an invalid result");
    const segments = result.map((item: unknown) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? (item as { text?: unknown }).text
          : undefined,
    );
    if (segments.some((segment) => typeof segment !== "string"))
      throw new Error("The segmentation service returned an invalid segment");
    const nonEmpty = (segments as string[]).filter((segment) => segment.trim());
    if (text.trim() && !nonEmpty.length) throw new Error("The segmentation service returned no text segments");
    return nonEmpty;
  }

  async embedText(model: string, text: string, requestOptions: ClientRequestOptions = {}): Promise<Embedding> {
    requestOptions.signal?.throwIfAborted();
    let resolvedModel = model;
    const config = browserProviderConfig(requestOptions.signal);
    const result = await embed({
      adapter: gatewayEmbedding(model, this.apiKey, {
        ...config,
        maxRetries: 0,
        fetch: async (input, init) => {
          const response = await config.fetch(input, init);
          if (response.ok) {
            const body = await response.clone().json();
            if (typeof body.model === "string" && body.model) resolvedModel = body.model;
          }
          return response;
        },
      }),
      input: text,
      middleware: [aiTelemetry("embedding", requestOptions.parentContext)],
    }).catch((error: unknown) => {
      requestOptions.signal?.throwIfAborted();
      throw error;
    });
    requestOptions.signal?.throwIfAborted();
    const vector = result.embeddings[0]?.vector;
    validateEmbeddingVector(vector);
    if (!resolvedModel) throw new Error("The embedding service returned no model identity");
    // TanStack reports the requested alias; retrieval indexes must instead
    // remember the actual embedding model returned by the gateway.
    return { vector, model: resolvedModel };
  }

  async translate(
    model: string,
    lang: string,
    input: string | Blob,
    requestOptions: ClientRequestOptions = {},
  ): Promise<string | Blob> {
    const data = new FormData();
    // An empty model lets the platform pick its default translator.
    if (model) data.append("model", model);
    data.append("lang", lang);
    const headers: Record<string, string> = {};

    if (input instanceof Blob) {
      data.append("file", input);
      headers.Accept = input.type || "application/octet-stream";
    } else {
      data.append("text", input);
    }

    return this.postRaw<string | Blob>(
      "/api/v1/translate",
      data,
      async (resp) => {
        const contentType = resp.headers.get("content-type")?.toLowerCase() || "";
        if (contentType.includes("text/plain") || contentType.includes("text/markdown")) {
          return (await resp.text()).replace(/ß/g, "ss");
        }
        return resp.blob();
      },
      headers,
      90_000,
      requestOptions,
    );
  }

  async rewriteText(
    model: string,
    text: string,
    lang?: string,
    tone?: string,
    style?: string,
    userPrompt?: string,
    requestOptions: ClientRequestOptions = {},
  ): Promise<string> {
    requestOptions.signal?.throwIfAborted();
    if (!text.trim()) return text;

    const tones: Record<string, string> = {
      enthusiastic: "Use an enthusiastic and energetic tone.",
      friendly: "Use a warm and friendly tone.",
      confident: "Use a confident and assertive tone.",
      diplomatic: "Use a diplomatic and tactful tone.",
    };
    const styles: Record<string, string> = {
      simple: "Use simple and clear language.",
      business: "Use professional business language.",
      academic: "Use formal academic language.",
      casual: "Use casual and informal language.",
    };

    const parts = [tone && tones[tone], style && styles[style]].filter(Boolean);
    if (userPrompt?.trim()) parts.push(`Custom instruction: ${userPrompt.trim()}`);
    const finalInstructions = parts.length > 0 ? parts.join(" ") : "Maintain the original tone and style";
    const languageInstruction = lang
      ? `Ensure the text is in ${lang} language${lang !== "en" ? ", translating if necessary" : ""}.`
      : "Maintain the original language of the text.";

    const result = await this.parse(
      model,
      instructionsRewriteText
        .replace("{languageInstruction}", () => languageInstruction)
        .replace("{finalInstructions}", () => finalInstructions),
      text,
      z.object({ rewrittenText: z.string() }).strict(),
      "rewrite_text",
      requestOptions,
    );
    return result?.rewrittenText ?? text;
  }

  async generateAudio(
    model: string,
    input: string,
    voice?: string,
    requestOptions: ClientRequestOptions = {},
  ): Promise<Blob> {
    requestOptions.signal?.throwIfAborted();
    if (!input.trim()) throw new Error("Input text cannot be empty");
    const result = await generateSpeech({
      debug: aiDebug,
      adapter: gatewaySpeech(model, this.apiKey, browserProviderConfig(requestOptions.signal)),
      text: input,
      voice: voice ?? "",
      format: "wav",
      modelOptions: { instructions: "Speak in a clear and natural tone." },
      abortSignal: requestOptions.signal,
      middleware: [aiTelemetry("audio", requestOptions.parentContext)],
    });
    const bytes = decodeBase64(result.audio);
    if (!bytes.byteLength) throw new Error("The speech service returned empty audio");
    return new Blob([bytes], { type: result.contentType ?? "audio/wav" });
  }

  async speakText(
    model: string,
    input: string,
    voice?: string,
    sinkId?: string,
    options: ClientRequestOptions & { onPlaying?: () => void } = {},
  ): Promise<void> {
    const audioBlob = await this.generateAudio(model, input, voice, options);
    await playAudioBlob(audioBlob, { ...options, sinkId });
  }

  async transcribe(model: string, blob: Blob, requestOptions: ClientRequestOptions = {}): Promise<string> {
    requestOptions.signal?.throwIfAborted();
    if (!blob.size) throw new Error("No audio to transcribe");
    // Strip any ";codecs=…" parameter (MediaRecorder emits "audio/webm;codecs=opus").
    const baseType = blob.type.split(";")[0].trim();
    const extension = TRANSCRIBE_EXTENSIONS[baseType] || mime.getExtension(baseType) || "audio";
    const file = new File([blob], `audio_recording.${extension}`, { type: blob.type });
    const result = await generateTranscription({
      debug: aiDebug,
      adapter: gatewayTranscription(model, this.apiKey, browserProviderConfig(requestOptions.signal)),
      audio: file,
      abortSignal: requestOptions.signal,
      middleware: [aiTelemetry("audio", requestOptions.parentContext)],
    });
    if (typeof result.text !== "string") throw new Error("The transcription service returned an invalid response");
    return result.text;
  }

  async search(
    model: string,
    query: string,
    options?: { domains?: string[]; limit?: number },
    requestOptions: ClientRequestOptions = {},
  ): Promise<SearchResult[]> {
    const data = new FormData();
    if (model) data.append("model", model);
    data.append("query", query);
    data.append("limit", String(options?.limit ?? 10));
    for (const domain of options?.domains ?? []) data.append("domain", domain);

    const results = await this.postRaw(
      "/api/v1/search",
      data,
      (resp) => resp.json(),
      undefined,
      90_000,
      requestOptions,
    );
    if (!Array.isArray(results)) return [];

    return results.map((result: SearchResult) => {
      let content = simplifyMarkdown(result.content || "");
      if (content.length > 10000) content = `${content.slice(0, 10000)}... [truncated]`;
      return { source: result.source, title: result.title, content, metadata: result.metadata };
    });
  }

  async guard(model: string, text: string, requestOptions: ClientRequestOptions = {}): Promise<GuardResult> {
    const result = await this.postRaw(
      "/api/v1/guard",
      JSON.stringify({ ...(model && { model }), text }),
      (resp) => resp.json(),
      {
        "Content-Type": "application/json",
      },
      90_000,
      requestOptions,
    );
    return {
      flagged: result?.flagged === true,
      categories: Array.isArray(result?.categories) ? result.categories : [],
    };
  }

  async research(model: string, instructions: string, requestOptions: ClientRequestOptions = {}): Promise<string> {
    const result = await this.post(
      "/api/v1/research",
      { ...(model && { model }), instructions },
      (resp) => resp.json(),
      requestOptions,
    );
    return result.content || "";
  }

  async generateImage(
    model: string,
    prompt: string,
    images?: Blob[],
    options?: ImageRenderOptions,
    requestOptions: ClientRequestOptions = {},
  ): Promise<Blob> {
    const data = new FormData();
    data.append("input", prompt);
    if (model) data.append("model", model);
    images?.forEach((blob, i) => {
      data.append("file", blob, `image_${i}.${mime.getExtension(blob.type) || "image"}`);
    });
    if (options?.aspectRatio) data.append("aspect_ratio", options.aspectRatio);
    if (options?.quality) data.append("quality", options.quality);
    if (options?.resolution) data.append("resolution", options.resolution);
    if (options?.background) data.append("background", options.background);
    // Output format is negotiated via Accept, not a form field (see /v1/render).
    const headers = options?.format ? { Accept: `image/${options.format}` } : undefined;
    // Rendering — especially high quality or large sizes — can take minutes, so
    // allow well beyond the default render/translate/search budget.
    return this.postRaw("/api/v1/render", data, (resp) => resp.blob(), headers, 300_000, requestOptions);
  }

  async optimizeSkill(
    model: string,
    name: string,
    description: string,
    content: string,
  ): Promise<{ name: string; description: string; content: string }> {
    const result = await this.parse(
      model,
      instructionsOptimizeSkill,
      JSON.stringify({ name, description, content }),
      z.object({ name: z.string(), description: z.string(), content: z.string() }).strict(),
      "optimize_skill",
    );
    return {
      name: result?.name ?? name,
      description: result?.description ?? description,
      content: result?.content ?? content,
    };
  }

  async parse<T extends z.ZodType<any>>(
    model: string,
    instructions: string,
    input: string,
    schema: T,
    name: string,
    options: ParseOptions = {},
  ): Promise<z.infer<T> | null> {
    const maxOutputTokens = this.outputTokenBudget(
      model,
      options.maxOutputTokens,
      name === "title_chat" ? 8_000 : 16_000,
    );
    options.signal?.throwIfAborted();
    const result = await chat({
      adapter: this.textAdapter(model, options.signal),
      debug: aiDebug,
      systemPrompts: [instructions],
      messages: [{ role: "user", content: input }],
      outputSchema: schema,
      stream: false,
      modelOptions: this.chatModelOptions(model, { ...options, maxOutputTokens }),
      middleware: [aiTelemetry(name, options.parentContext)],
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "structured-output-missing-result")
        return null;
      throw error;
    });
    options.signal?.throwIfAborted();
    // TanStack validates the output; its public schema type infers the input.
    return result as z.output<T> | null;
  }

  private outputTokenBudget(model: string, requested?: number, defaultBudget?: number): number | undefined {
    const capacity =
      this.modelOverrides.get(model)?.maxOutputTokens ??
      this.modelInfo.find((info) => info.id === model)?.maxOutputTokens ??
      modelMaxOutputTokens(model);
    return outputTokenAllowance(capacity, requested, defaultBudget);
  }

  private async post<T>(
    path: string,
    fields: Record<string, string | Blob>,
    read: (resp: Response) => Promise<T>,
    requestOptions: ClientRequestOptions = {},
  ): Promise<T> {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    return this.postRaw(path, data, read, undefined, 90_000, requestOptions);
  }

  private async postRaw<T>(
    path: string,
    data: BodyInit,
    read: (resp: Response) => Promise<T>,
    headers?: HeadersInit,
    timeoutMs = 90_000,
    requestOptions: ClientRequestOptions = {},
  ): Promise<T> {
    // Raw fetch has no built-in timeout; without this a stalled backend (render,
    // translate, search) hangs forever — and when called from a Python bridge it
    // wedges the single interpreter worker and every queued sandbox call. Image
    // generation can legitimately run for minutes, so its caller passes a larger
    // budget (see generateImage).
    requestOptions.signal?.throwIfAborted();
    const timeoutController = new AbortController();
    const combinedSignal = combineAbortSignals(requestOptions.signal, timeoutController.signal);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    try {
      const resp = await fetch(new URL(path, window.location.origin), {
        method: "POST",
        headers,
        body: data,
        signal: combinedSignal.signal,
      });
      if (!resp.ok) {
        const detail = await readErrorBody(resp);
        combinedSignal.signal?.throwIfAborted();
        throw new Error(`${path} failed with status ${resp.status}${detail ? `: ${detail}` : ""}`);
      }
      // Fetch resolves at headers. Keep cancellation and the deadline connected
      // until the body has finished, including failed response bodies.
      const result = await read(resp);
      combinedSignal.signal?.throwIfAborted();
      return result;
    } catch (error) {
      requestOptions.signal?.throwIfAborted();
      // Surface a readable timeout instead of the runtime's opaque abort message
      // (WebKit reports a timed-out fetch as the cryptic "Fetch is aborted").
      if (timedOut) throw new Error(`${path} timed out after ${Math.round(timeoutMs / 1000)}s`);
      throw error;
    } finally {
      clearTimeout(timer);
      combinedSignal.cleanup();
    }
  }
}
