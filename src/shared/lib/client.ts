import mime from "mime";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod/v3";
import instructionsClassifyChat from "@/features/chat/prompts/chat-classify.txt?raw";
import instructionsConvertCsv from "@/features/chat/prompts/convert-csv.txt?raw";
import instructionsConvertMd from "@/features/chat/prompts/convert-md.txt?raw";
import instructionsRewriteSelection from "@/features/chat/prompts/rewrite-selection.txt?raw";
import instructionsRewriteText from "@/features/chat/prompts/rewrite-text.txt?raw";
import instructionsSummarizeHistory from "@/features/chat/prompts/summarize-history.txt?raw";
import type { SearchResult } from "@/features/research/types/search";
import instructionsOptimizeSkill from "@/prompts/skill-optimizer.txt?raw";
import type {
  Content,
  FileContent,
  ImageContent,
  Message,
  Model,
  ModelType,
  ReasoningContent,
  Tool,
  ToolCallContent,
  ToolResultContent,
} from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import type { AgentContext } from "@/shared/types/telemetry";
import { isAbortError } from "./errors";
import { modelName, modelType } from "./models";
import { traceGenAI } from "./otel";
import { dropOrphanFunctionCalls } from "./recovery";
import { serializeToolResultForApi, simplifyMarkdown } from "./utils";

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
  quality?: "low" | "medium" | "high";
  /** Output resolution. */
  resolution?: "512" | "1K" | "2K" | "4K";
  /** Background handling (only honored by models that support it). */
  background?: "transparent" | "opaque";
  /** Desired output format; negotiated via the `Accept` header, not a form field. */
  format?: "png" | "jpeg" | "webp";
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
  private oai: OpenAI;

  constructor(apiKey: string = "sk-") {
    this.oai = new OpenAI({
      baseURL: new URL("/api/v1", window.location.origin).toString(),
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
      // Configure automatic retries for rate limits and server errors
      // maxRetries is set to 3 attempts (default is 2)
      maxRetries: 3,
      // Uses SDK default timeout of 10 minutes for complex operations
    });
  }

  async listModels(type?: ModelType): Promise<Model[]> {
    const models = await this.oai.models.list();
    const mappedModels = models.data.map((model) => {
      const type = modelType(model.id);
      const name = modelName(model.id);

      return {
        id: model.id,
        name: name,
        type: type,
      };
    });

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

  async complete(
    model: string,
    instructions: string,
    input: Message[],
    tools: Tool[],
    handler?: (content: Content[]) => void,
    options?: {
      effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
      summary?: "auto" | "concise" | "detailed";
      verbosity?: "low" | "medium" | "high";
      signal?: AbortSignal;
      parentContext?: AgentContext;
    },
  ): Promise<Message> {
    return traceGenAI(
      "chat",
      model,
      async () => {
        const items: OpenAI.Responses.ResponseInputItem[] = [];

        for (const m of input) {
          switch (m.role) {
            case Role.User: {
              const content: OpenAI.Responses.ResponseInputContent[] = [];

              // Process all content parts
              for (const part of m.content) {
                if (part.type === "text") {
                  content.push({ type: "input_text", text: part.text });
                } else if (part.type === "image") {
                  const imgPart = part as ImageContent;
                  // Skip attachments with unrecognized MIME (e.g. application/octet-stream)
                  if (imgPart.data.startsWith("data:application/octet-stream")) continue;
                  content.push({
                    type: "input_image",
                    image_url: imgPart.data,
                    detail: "auto",
                  });
                } else if (part.type === "file") {
                  const filePart = part as FileContent;
                  if (filePart.data.startsWith("data:application/octet-stream")) continue;
                  content.push({
                    type: "input_file",
                    file_data: filePart.data,
                  });
                } else if (part.type === "tool_result") {
                  // Tool results in user messages go as function_call_output
                  // Binary data (images, audio, files) is stripped and replaced with descriptions
                  // since the model cannot process base64 data in text output
                  const tr = part as ToolResultContent;
                  const output = serializeToolResultForApi(tr.result);
                  items.push({
                    type: "function_call_output",
                    call_id: tr.id,
                    output: output,
                  });
                }
                // Skip reasoning, tool_call in user messages
              }

              // Only add user message if there's content (not just tool results)
              if (content.length > 0) {
                items.push({
                  type: "message",
                  role: "user",
                  content: content,
                });
              }

              break;
            }

            case Role.Assistant: {
              // Reasoning items are intentionally not replayed back to the API.
              // encrypted_content is provider+key-specific and breaks on model
              // swaps and across Azure deployments/subscriptions.

              let bufferedText = "";

              const flushAssistantText = () => {
                if (!bufferedText) {
                  return;
                }

                items.push({
                  type: "message",
                  role: "assistant",
                  content: bufferedText,
                });

                bufferedText = "";
              };

              for (const part of m.content) {
                if (part.type === "text") {
                  bufferedText += part.text;
                  continue;
                }

                if (part.type === "tool_call") {
                  flushAssistantText();
                  items.push({
                    type: "function_call",
                    call_id: part.id,
                    name: part.name,
                    arguments: part.arguments,
                  });
                }

                if (part.type === "summary") {
                  // Replay client-side summary as assistant text. The wrapper
                  // tells the model the prior context was condensed and to
                  // continue naturally without referencing the summary itself.
                  flushAssistantText();
                  items.push({
                    type: "message",
                    role: "assistant",
                    content: `[Earlier conversation condensed to save context. Continue naturally without referencing this summary.]\n\n${part.text}`,
                  });
                }
              }

              flushAssistantText();

              break;
            }
          }
        }

        const contentParts: Content[] = [];

        // Get-or-create the single reasoning part (always at index 0).
        const ensureReasoning = (id: string): ReasoningContent => {
          let part = contentParts.find((p): p is ReasoningContent => p.type === "reasoning");
          if (!part) {
            part = { type: "reasoning", id, text: "" };
            contentParts.unshift(part);
          }
          return part;
        };

        const emit = () => handler?.([...contentParts]);

        // Track in-flight tool calls by their output index so we can grow their
        // arguments as deltas arrive. (output_index is present on every event;
        // the item id is optional and the call id isn't on the delta events.)
        const toolCallsByIndex = new Map<number, ToolCallContent>();

        const runner = this.oai.responses
          .stream({
            model: model,
            store: false,
            truncation: "auto",
            tools: this.toTools(tools),
            input: dropOrphanFunctionCalls(items),
            instructions: instructions,
            ...(options?.effort
              ? {
                  reasoning: {
                    effort: options.effort,
                    summary: options.summary ?? "auto",
                  },
                }
              : {}),
            ...(options?.verbosity
              ? {
                  text: { verbosity: options.verbosity },
                }
              : {}),
          })
          .on("response.reasoning_summary_text.delta", (event) => {
            const r = ensureReasoning(event.item_id);
            r.summary = (r.summary ?? "") + event.delta;
            emit();
          })
          .on("response.reasoning_text.delta", (event) => {
            ensureReasoning(event.item_id).text += event.delta;
            emit();
          })
          .on("response.output_text.delta", (event) => {
            const last = contentParts[contentParts.length - 1];
            if (last?.type === "text") {
              last.text += event.delta;
            } else {
              contentParts.push({ type: "text", text: event.delta });
            }
            emit();
          })
          // Materialize the tool-call part as soon as the call starts, so its
          // spinner appears right after the intro instead of only once the model
          // has finished writing all the arguments.
          .on("response.output_item.added", (event) => {
            if (event.item.type === "function_call") {
              const part: ToolCallContent = {
                type: "tool_call",
                id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments ?? "",
              };
              toolCallsByIndex.set(event.output_index, part);
              contentParts.push(part);
              emit();
            }
          })
          // Grow the arguments live as the model writes them (e.g. the Python script).
          .on("response.function_call_arguments.delta", (event) => {
            const part = toolCallsByIndex.get(event.output_index);
            if (part) {
              part.arguments += event.delta;
              emit();
            }
          })
          .on("response.output_item.done", (event) => {
            if (event.item.type === "function_call") {
              const existing = toolCallsByIndex.get(event.output_index);
              if (existing) {
                existing.arguments = event.item.arguments; // authoritative final value
              } else {
                contentParts.push({
                  type: "tool_call",
                  id: event.item.call_id,
                  name: event.item.name,
                  arguments: event.item.arguments,
                });
              }
              emit();
            }
          });

        // Wire abort. Handle the already-aborted case explicitly —
        // addEventListener on a signal that has already fired never invokes.
        if (options?.signal) {
          if (options.signal.aborted) {
            runner.abort();
          } else {
            options.signal.addEventListener("abort", () => runner.abort(), { once: true });
          }
        }

        // Attach an error listener so mid-stream errors don't surface as
        // unhandled EventEmitter errors. The same error rejects
        // `finalResponse()` below, where we actually handle it.
        runner.on("error", () => {});

        const assistant: Message = { role: Role.Assistant, content: contentParts };

        try {
          const finalResponse = await runner.finalResponse();
          return {
            result: assistant,
            response: {
              id: finalResponse.id,
              model: finalResponse.model,
              inputTokens: finalResponse.usage?.input_tokens,
              cachedInputTokens: finalResponse.usage?.input_tokens_details?.cached_tokens,
              outputTokens: finalResponse.usage?.output_tokens,
              reasoningTokens: finalResponse.usage?.output_tokens_details?.reasoning_tokens,
            },
          };
        } catch (error) {
          // On abort (our signal or runner.abort()), return partial content
          // as a successful result.
          if (options?.signal?.aborted || isAbortError(error)) {
            return { result: assistant, response: { id: "", model } };
          }
          throw error;
        }
      },
      options?.parentContext,
    ); // end traceGenAI
  }

  async classifyChat(
    model: string,
    input: Message[],
    categories: Array<{ id: string; description: string }> = [],
    risks: Array<{ id: string; description: string }> = [],
  ): Promise<{
    title: string | null;
    categories: Array<{ id: string; confidence: number }>;
    risks: Array<{ id: string; confidence: number }>;
  }> {
    const history = input.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    const categoryIds = categories.map((c) => c.id);
    const riskIds = risks.map((r) => r.id);

    const categoryIdSchema = categoryIds.length > 0 ? z.enum(categoryIds as [string, ...string[]]) : z.string();
    const riskIdSchema = riskIds.length > 0 ? z.enum(riskIds as [string, ...string[]]) : z.string();

    const confidenceSchema = z
      .number()
      .describe(
        "Model confidence that this category or risk applies to the latest user message. " +
          "A value between 0 and 1, where higher values denote higher confidence. " +
          "Omit matches with confidence below ~0.5.",
      );

    const schema = z
      .object({
        title: z.string().describe("Short, descriptive title for the conversation. Less than 10 words, no quotes."),
        categories: z
          .array(
            z
              .object({
                id: categoryIdSchema.describe("Id of a category from the provided list."),
                confidence: confidenceSchema,
              })
              .strict(),
          )
          .describe("Categories that clearly apply to the latest user message. May be empty."),
        risks: z
          .array(
            z
              .object({
                id: riskIdSchema.describe("Id of a risk from the provided list."),
                confidence: confidenceSchema,
              })
              .strict(),
          )
          .describe("Risks that the latest user message actually triggers (not merely mentions). May be empty."),
      })
      .strict();

    const result = await this.parse(
      model,
      instructionsClassifyChat,
      JSON.stringify({ categories, risks, history }),
      schema,
      "classify_chat",
    );
    return {
      title: result?.title ?? null,
      categories: result?.categories ?? [],
      risks: result?.risks ?? [],
    };
  }

  /**
   * Summarize a conversation history into a single dense text block.
   * Used to condense older messages when the context window fills up.
   * Returns plain text — caller wraps it into a SummaryContent part.
   */
  async summarizeHistory(model: string, input: Message[]): Promise<string> {
    const history = input.map((m) => ({ role: m.role, content: m.content }));
    const result = await this.parse(
      model,
      instructionsSummarizeHistory,
      JSON.stringify({ history }),
      z.object({ summary: z.string() }).strict(),
      "summarize_history",
    );
    return result?.summary ?? "";
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

  async extractText(blob: Blob): Promise<string> {
    return (await this.post("/api/v1/extract", { file: blob, format: "text" })).text();
  }

  async scrape(model: string, url: string): Promise<string> {
    return (await this.post("/api/v1/extract", { ...(model && { model }), url, format: "text" })).text();
  }

  async segmentText(text: string): Promise<string[]> {
    const result = await (await this.post("/api/v1/segment", { text })).json();
    if (!Array.isArray(result)) return [];
    return result.map((item: { text?: string } | string) => (typeof item === "string" ? item : item.text || ""));
  }

  async embedText(model: string, text: string): Promise<number[]> {
    const embedding = await this.oai.embeddings.create({
      model: model,
      input: text,
      encoding_format: "float",
    });

    return embedding.data[0].embedding;
  }

  async translate(lang: string, input: string | Blob): Promise<string | Blob> {
    const data = new FormData();
    data.append("lang", lang);
    const headers: Record<string, string> = {};

    if (input instanceof Blob) {
      data.append("file", input);
      headers.Accept = input.type || "application/octet-stream";
    } else {
      data.append("text", input);
    }

    const resp = await this.postRaw("/api/v1/translate", data, headers);
    const contentType = resp.headers.get("content-type")?.toLowerCase() || "";

    if (contentType.includes("text/plain") || contentType.includes("text/markdown")) {
      return (await resp.text()).replace(/ß/g, "ss");
    }

    return resp.blob();
  }

  async rewriteText(
    model: string,
    text: string,
    lang?: string,
    tone?: string,
    style?: string,
    userPrompt?: string,
  ): Promise<string> {
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
        .replace("{languageInstruction}", languageInstruction)
        .replace("{finalInstructions}", finalInstructions),
      text,
      z.object({ rewrittenText: z.string() }).strict(),
      "rewrite_text",
    );
    return (result?.rewrittenText ?? text).replace(/ß/g, "ss");
  }

  async generateAudio(model: string, input: string, voice?: string): Promise<Blob> {
    if (!input.trim()) {
      throw new Error("Input text cannot be empty");
    }

    const response = await this.oai.audio.speech.create({
      model: model,
      input: input,

      instructions: "Speak in a clear and natural tone.",

      voice: voice ?? "",
      response_format: "wav",
    });

    const audioBuffer = await response.arrayBuffer();
    return new Blob([audioBuffer], { type: "audio/wav" });
  }

  async speakText(model: string, input: string, voice?: string, sinkId?: string): Promise<void> {
    const audioBlob = await this.generateAudio(model, input, voice);
    const audioUrl = URL.createObjectURL(audioBlob);

    const audio = new Audio(audioUrl);

    // Route to selected output device if supported
    if (sinkId && "setSinkId" in audio) {
      await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(sinkId);
    }

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        reject(new Error("Audio playback failed"));
      };

      audio.play().catch(reject);
    });
  }

  async transcribe(model: string, blob: Blob): Promise<string> {
    // Strip any ";codecs=…" parameter (MediaRecorder emits "audio/webm;codecs=opus").
    const baseType = blob.type.split(";")[0].trim();
    const extension = TRANSCRIBE_EXTENSIONS[baseType] || mime.getExtension(baseType) || "audio";
    const file = new File([blob], `audio_recording.${extension}`, { type: blob.type });
    const result = await (await this.post("/api/v1/audio/transcriptions", { file, ...(model && { model }) })).json();
    return result.text || "";
  }

  async search(
    model: string,
    query: string,
    options?: { domains?: string[]; limit?: number },
  ): Promise<SearchResult[]> {
    const data = new FormData();
    if (model) data.append("model", model);
    data.append("query", query);
    data.append("limit", String(options?.limit ?? 10));
    for (const domain of options?.domains ?? []) data.append("domain", domain);

    const resp = await this.postRaw("/api/v1/search", data);
    const results = await resp.json();
    if (!Array.isArray(results)) return [];

    return results.map((result: SearchResult) => {
      let content = simplifyMarkdown(result.content || "");
      if (content.length > 10000) content = `${content.slice(0, 10000)}... [truncated]`;
      return { source: result.source, title: result.title, content, metadata: result.metadata };
    });
  }

  async research(model: string, instructions: string): Promise<string> {
    const result = await (await this.post("/api/v1/research", { ...(model && { model }), instructions })).json();
    return result.content || "";
  }

  async generateImage(model: string, prompt: string, images?: Blob[], options?: ImageRenderOptions): Promise<Blob> {
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
    return (await this.postRaw("/api/v1/render", data, headers, 300_000)).blob();
  }

  private toTools(tools: Tool[]): OpenAI.Responses.Tool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: "function",

      name: tool.name,
      description: tool.description,

      strict: tool.strict ?? false,
      parameters: tool.parameters,
    }));
  }

  async optimizeSkill(
    model: string,
    name: string,
    description: string,
    content: string,
  ): Promise<{ name: string; description: string; content: string }> {
    const instructions = instructionsOptimizeSkill
      .replace("{name}", name || "")
      .replace("{description}", description || "")
      .replace("{content}", content || "");
    const result = await this.parse(
      model,
      instructions,
      `Optimize this skill: "${name}"`,
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
    parentContext?: AgentContext,
  ): Promise<z.infer<T> | null> {
    return traceGenAI(
      name,
      model,
      async () => {
        try {
          const response = await this.oai.responses.parse({
            model,
            instructions,
            input,
            truncation: "auto",
            text: { format: zodTextFormat(schema, name) },
          });
          return { result: response.output_parsed ?? null };
        } catch (error) {
          if (isAbortError(error)) throw error;
          console.error(`Error in ${name}:`, error);
          return { result: null };
        }
      },
      parentContext,
    );
  }

  private async post(path: string, fields: Record<string, string | Blob>): Promise<Response> {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    return this.postRaw(path, data);
  }

  private async postRaw(path: string, data: FormData, headers?: HeadersInit, timeoutMs = 90_000): Promise<Response> {
    // Raw fetch has no built-in timeout; without this a stalled backend (render,
    // translate, search) hangs forever — and when called from a Python bridge it
    // wedges the single interpreter worker and every queued sandbox call. Image
    // generation can legitimately run for minutes, so its caller passes a larger
    // budget (see generateImage).
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(new URL(path, window.location.origin), {
        method: "POST",
        headers,
        body: data,
        signal: controller.signal,
      });
    } catch (error) {
      // Surface a readable timeout instead of the runtime's opaque abort message
      // (WebKit reports a timed-out fetch as the cryptic "Fetch is aborted").
      if (timedOut) throw new Error(`${path} timed out after ${Math.round(timeoutMs / 1000)}s`);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const detail = await readErrorBody(resp);
      throw new Error(`${path} failed with status ${resp.status}${detail ? `: ${detail}` : ""}`);
    }
    return resp;
  }
}
