import { context } from "@opentelemetry/api";
import { playAudioBlob } from "./audioPlayback";
import mime from "mime";
import { chat, decide, embed, generateSpeech, generateTranscription } from "@tanstack/ai";
import { z } from "zod";
import instructionsConvertCsv from "@/features/chat/prompts/convert-csv.txt?raw";
import instructionsConvertMd from "@/features/chat/prompts/convert-md.txt?raw";
import instructionsRewriteSelection from "@/features/chat/prompts/rewrite-selection.txt?raw";
import instructionsRewriteText from "@/features/translate/prompts/rewrite-text.txt?raw";
import instructionsTitleChat from "@/features/chat/prompts/chat-title.txt?raw";
import { sanitizeForClassification } from "@/features/chat/lib/chatHistory";
import {
  type ClassificationItem,
  type ClassificationMatch,
  classificationRequest,
} from "@/features/chat/lib/classificationQuestions";
import instructionsOptimizeSkill from "@/prompts/skill-optimizer.txt?raw";
import type { UIMessage } from "@tanstack/ai";
import type {
  ImageComplexity,
  ImageFormat,
  ImageQuality,
  Model,
  ModelType,
  ReasoningEffort,
} from "@/shared/types/chat";
import type { AgentContext } from "@/shared/types/telemetry";
import { type Embedding, validateEmbeddingVector } from "./embeddings";
import { modelFromAPI, modelMaxOutputTokens, outputTokenAllowance } from "./models";
import { aiTelemetry, telemetryHeaders } from "./otel";
import { aiDebug } from "./aiStream";
import {
  browserProviderConfig,
  gatewayEmbedding,
  gatewaySpeech,
  gatewayText,
  gatewayTranscription,
} from "./aiProvider";
import { decodeBase64 } from "./utils";
import { GatewayEvaluateAdapter } from "./gatewayEvaluate";

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
  /**
   * Desired output format; negotiated via the `Accept` header, not a form field.
   * SVG and GIF are text-to-image only — the backend rejects them with images.
   */
  format?: "png" | "jpeg" | "webp" | ImageFormat;
  /** How much the model plans before rendering (separate from quality). */
  complexity?: ImageComplexity;
  /** Animated GIF frame count; GIF output only. */
  frameCount?: number;
  /** Animated GIF time per frame in milliseconds; GIF output only. */
  frameDurationMs?: number;
  /**
   * Edit guide for the first image: a PNG of the same size whose fully
   * transparent pixels mark where the image may change. Models without
   * native inpainting get it emulated by the backend.
   */
  mask?: Blob;
  /** Transparent PNG with annotations (arrows, circles, notes) drawn over the first image. */
  markup?: Blob;
}

/** Trace and cancellation context shared by every cancellable client request. */
export interface ClientRequestOptions {
  signal?: AbortSignal;
  parentContext?: AgentContext;
}

export interface RewriteOptions {
  /** Target language code; the model is told its name. */
  lang?: string;
  /** "formal" | "informal": the register of address. */
  formality?: string;
  /** "plain" | "professional" | "natural" | "technical". */
  style?: string;
  /** Free instruction; overrides the presets where they conflict. */
  instruction?: string;
  /** The untranslated original, as a fidelity reference. */
  source?: string;
}

// Each option says what to change and what to leave alone, so a formality and a
// style combine without conflicting and never justify adding content.
const FORMALITY_INSTRUCTIONS: Record<string, string> = {
  formal:
    "Formal register: use the polite form of address where {language} has one (for example Sie, vous, usted, Lei, formal Japanese), full forms instead of contractions, no slang; courteous without being stiff.",
  informal:
    "Informal register: use the familiar form of address where {language} has one (for example du, tu, tú), contractions and everyday wording; relaxed but still correct.",
};

const STYLE_INSTRUCTIONS: Record<string, string> = {
  plain:
    "Plain language: short sentences, common words, one idea per sentence, active voice; spell out jargon and abbreviations; keep every fact.",
  professional:
    "Professional writing: precise, courteous and concise, with the standard phrasing of business correspondence in {language}; no colloquialisms, no filler.",
  natural:
    "Idiomatic: make it read as if written by a native speaker of {language}; restructure sentences that still follow the source language's word order or idioms.",
  technical:
    "Technical and legal precision: keep terminology, sentence structure and formatting exactly; prefer literal wording over paraphrase and translate each term consistently.",
};

/** English name of a language tag ("de-CH" → "German (Switzerland)"); the tag itself when unknown. */
function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
}

/** A gateway endpoint answered with an error status; `status` lets callers react to specific ones. */
export class HttpError extends Error {
  readonly status: number;

  constructor(path: string, status: number, detail = "") {
    super(`${path} failed with status ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "HttpError";
    this.status = status;
  }
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

  textAdapter(model: string, signal?: AbortSignal, requestContext?: () => AgentContext) {
    return gatewayText(model, this.apiKey, browserProviderConfig(signal, requestContext));
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

  /** Keep SDK-specific option placement here so all chat callers migrate together. */
  chatOptions(
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
    const modelOptions = {
      store: false,
      include: ["reasoning.encrypted_content" as const],
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
      ...(options?.verbosity ? { text: { verbosity: options.verbosity } } : {}),
    };
    // chat({ reasoning }) is dropped for gateway aliases, which have no OpenAI
    // reasoning metadata, and it only sends summary "auto". modelOptions is
    // still spread into the request, so the gateway's own clamping applies.
    return {
      modelOptions: {
        ...modelOptions,
        ...(options?.effort || options?.summary
          ? { reasoning: { effort: options.effort, summary: options.summary } }
          : {}),
      },
    };
  }

  async generateTitle(model: string, input: UIMessage[], options: ParseOptions = {}): Promise<string | null> {
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
    input: UIMessage[],
    categories: ClassificationItem[] = [],
    risks: ClassificationItem[] = [],
    requestOptions: ClientRequestOptions & Pick<ParseOptions, "effort"> = {},
  ): Promise<{ categories: ClassificationMatch[]; risks: ClassificationMatch[] }> {
    const request = classificationRequest(input, categories, risks);
    if (!request) return { categories: [], risks: [] };
    const telemetry = aiTelemetry("classify_chat", requestOptions.parentContext);
    const result = await decide({
      adapter: new GatewayEvaluateAdapter(model, (body, signal) =>
        this.postRaw(
          "/api/v1/systemone",
          JSON.stringify(body),
          (resp) => resp.json(),
          { "Content-Type": "application/json" },
          30_000,
          { ...requestOptions, signal, parentContext: telemetry.requestContext() },
        ),
      ),
      ...request,
      modelOptions: { effort: requestOptions.effort },
      abortSignal: requestOptions.signal,
      debug: aiDebug,
      middleware: [telemetry],
    });
    return {
      categories: result.category ? [{ id: result.category.value, confidence: result.category.confidence }] : [],
      risks: risks.map((risk, index) => ({ id: risk.id, confidence: result[`risk_${index}`].probability })),
    };
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
    const telemetry = aiTelemetry("embedding", requestOptions.parentContext);
    const config = browserProviderConfig(requestOptions.signal, telemetry.requestContext);
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
      middleware: [telemetry],
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

  /**
   * Translate text or a file. A file comes back as a translated document of the
   * same type, or as text when `accept` asks for `text/plain` (translators that
   * only read documents answer 406 to a document request; see `HttpError`).
   */
  async translate(
    model: string,
    lang: string,
    input: string | Blob,
    requestOptions: ClientRequestOptions & { accept?: string } = {},
  ): Promise<string | Blob> {
    const { accept, ...options } = requestOptions;
    const data = new FormData();
    // An empty model lets the platform pick its default translator.
    if (model) data.append("model", model);
    data.append("lang", lang);
    const headers: Record<string, string> = {};

    if (input instanceof Blob) {
      data.append("file", input);
      headers.Accept = accept ?? (input.type || "application/octet-stream");
    } else {
      data.append("text", input);
      if (accept) headers.Accept = accept;
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
      // Whole documents take longer than a paragraph of text.
      input instanceof Blob ? 300_000 : 90_000,
      options,
    );
  }

  /**
   * Revise translated text: a formality (register of address), a style, and/or
   * a free instruction. `source` is the untranslated original, given to the
   * model as a fidelity reference only. Nothing requested returns the text as is.
   */
  async rewriteText(
    model: string,
    text: string,
    options: RewriteOptions = {},
    requestOptions: ClientRequestOptions = {},
  ): Promise<string> {
    requestOptions.signal?.throwIfAborted();
    if (!text.trim()) return text;
    const language = options.lang ? languageLabel(options.lang) : "the text's language";
    const parts = [
      options.formality && FORMALITY_INSTRUCTIONS[options.formality]?.replaceAll("{language}", language),
      options.style && STYLE_INSTRUCTIONS[options.style]?.replaceAll("{language}", language),
      options.instruction?.trim() &&
        `Instruction from the user, which takes precedence where it conflicts with the above: ${options.instruction.trim()}`,
    ].filter((part): part is string => !!part);
    if (parts.length === 0) return text;
    const reference = options.source?.trim()
      ? `The source text it translates, for fidelity only; do not translate it again:\n<source>\n${options.source.trim()}\n</source>`
      : "No source text is available; judge fidelity from the translation itself.";

    const result = await this.parse(
      model,
      instructionsRewriteText
        .replaceAll("{language}", () => language)
        .replace("{reference}", () => reference)
        .replace("{instructions}", () => parts.map((part) => `- ${part}`).join("\n")),
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
    const telemetry = aiTelemetry("audio", requestOptions.parentContext);
    const result = await generateSpeech({
      threadId: crypto.randomUUID(),
      debug: aiDebug,
      adapter: gatewaySpeech(
        model,
        this.apiKey,
        browserProviderConfig(requestOptions.signal, telemetry.requestContext),
      ),
      text: input,
      voice: voice ?? "",
      format: "wav",
      modelOptions: { instructions: "Speak in a clear and natural tone." },
      abortSignal: requestOptions.signal,
      middleware: [telemetry],
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
    const telemetry = aiTelemetry("audio", requestOptions.parentContext);
    const result = await generateTranscription({
      threadId: crypto.randomUUID(),
      debug: aiDebug,
      adapter: gatewayTranscription(
        model,
        this.apiKey,
        browserProviderConfig(requestOptions.signal, telemetry.requestContext),
      ),
      audio: file,
      abortSignal: requestOptions.signal,
      middleware: [telemetry],
    });
    if (typeof result.text !== "string") throw new Error("The transcription service returned an invalid response");
    return result.text;
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
    if (options?.mask) data.append("mask", options.mask, "mask.png");
    if (options?.markup) data.append("markup", options.markup, "markup.png");
    if (options?.aspectRatio) data.append("aspect_ratio", options.aspectRatio);
    if (options?.quality) data.append("quality", options.quality);
    if (options?.resolution) data.append("resolution", options.resolution);
    if (options?.background) data.append("background", options.background);
    if (options?.complexity) data.append("complexity", options.complexity);
    if (options?.frameCount !== undefined) data.append("frame_count", String(options.frameCount));
    if (options?.frameDurationMs !== undefined) data.append("frame_duration_ms", String(options.frameDurationMs));
    // Output format is negotiated via Accept, not a form field (see /v1/render).
    const headers = options?.format ? { Accept: mime.getType(options.format) ?? `image/${options.format}` } : undefined;
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
    const telemetry = aiTelemetry(name, options.parentContext);
    const result = await chat({
      threadId: crypto.randomUUID(),
      adapter: this.textAdapter(model, options.signal, telemetry.requestContext),
      debug: aiDebug,
      systemPrompts: [instructions],
      messages: [{ role: "user", content: input }],
      outputSchema: schema,
      stream: false,
      ...this.chatOptions(model, { ...options, maxOutputTokens }),
      middleware: [telemetry],
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
    const signal = AbortSignal.any([
      timeoutController.signal,
      ...(requestOptions.signal ? [requestOptions.signal] : []),
    ]);
    const timer = setTimeout(() => {
      timeoutController.abort(
        new DOMException(`${path} timed out after ${Math.round(timeoutMs / 1000)}s`, "TimeoutError"),
      );
    }, timeoutMs);
    try {
      const resp = await fetch(new URL(path, window.location.origin), {
        method: "POST",
        headers: telemetryHeaders(requestOptions.parentContext ?? context.active(), headers),
        body: data,
        signal,
      });
      if (!resp.ok) {
        const detail = await readErrorBody(resp);
        signal.throwIfAborted();
        throw new HttpError(path, resp.status, detail);
      }
      // Fetch resolves at headers. Keep cancellation and the deadline connected
      // until the body has finished, including failed response bodies.
      const result = await read(resp);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      requestOptions.signal?.throwIfAborted();
      // Surface a readable timeout instead of the runtime's opaque abort message
      // (WebKit reports a timed-out fetch as the cryptic "Fetch is aborted").
      timeoutController.signal.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
