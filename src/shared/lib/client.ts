import { z } from "zod/v3";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import mime from "mime";

import { Role } from "@/shared/types/chat";
import type {
  Tool,
  Content,
  ImageContent,
  FileContent,
  ToolResultContent,
  ReasoningContent,
} from "@/shared/types/chat";
import type { Message, Model, ModelType } from "@/shared/types/chat";
import type { SearchResult } from "@/features/research/types/search";
import { modelType, modelName } from "./models";
import { simplifyMarkdown, serializeToolResultForApi } from "./utils";
import { traceGenAI } from "./otel";

import instructionsConvertCsv from "@/features/chat/prompts/convert-csv.txt?raw";
import instructionsConvertMd from "@/features/chat/prompts/convert-md.txt?raw";
import instructionsRelatedPrompts from "@/features/chat/prompts/chat-suggestions.txt?raw";
import instructionsRewriteSelection from "@/features/chat/prompts/rewrite-selection.txt?raw";
import instructionsRewriteText from "@/features/chat/prompts/rewrite-text.txt?raw";
import instructionsSummarizeTitle from "@/features/chat/prompts/chat-title.txt?raw";
import instructionsOptimizeSkill from "@/prompts/skill-optimizer.txt?raw";

function expandToSentences(text: string, start: number, end: number): string {
  const sentenceBoundaries = /[.!?]+\s*|\n+/g;
  const boundaries: number[] = [0];
  let match;
  while ((match = sentenceBoundaries.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }
  boundaries.push(text.length);

  let sentenceStart = 0;
  let sentenceEnd = text.length;
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (boundaries[i] < end && boundaries[i + 1] > start) {
      sentenceStart = Math.min(sentenceStart === 0 ? boundaries[i] : sentenceStart, boundaries[i]);
      sentenceEnd = Math.max(sentenceEnd === text.length ? boundaries[i + 1] : sentenceEnd, boundaries[i + 1]);
    }
  }
  return text.substring(sentenceStart, sentenceEnd).trim();
}

export class Client {
  private oai: OpenAI;

  constructor(apiKey: string = "sk-") {
    this.oai = new OpenAI({
      baseURL: new URL("/api/v1", window.location.origin).toString(),
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
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

  async complete(
    model: string,
    instructions: string,
    input: Message[],
    tools: Tool[],
    handler?: (content: Content[]) => void,
    options?: {
      effort?: "none" | "minimal" | "low" | "medium" | "high";
      summary?: "auto" | "concise" | "detailed";
      verbosity?: "low" | "medium" | "high";
      compactThreshold?: number;
      signal?: AbortSignal;
    },
  ): Promise<Message> {
    return traceGenAI(
      "chat",
      model,
      async () => {
        input = this.sanitizeMessages(input);

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
                  // data is already a full data URL
                  content.push({
                    type: "input_image",
                    image_url: imgPart.data,
                    detail: "auto",
                  });
                } else if (part.type === "file") {
                  const filePart = part as FileContent;
                  // data is already a full data URL
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
              // TODO: Re-enable reasoning items once encrypted_content verification is fixed server-side
              // Temporarily skip sending reasoning items back to API to avoid invalid_encrypted_content errors
              // const reasoningParts = m.content.filter((p): p is ReasoningContent => p.type === 'reasoning' && !!p.signature);
              // for (const rp of reasoningParts) {
              //   const reasoningItem: Record<string, unknown> = {
              //     id: rp.id,
              //     type: "reasoning",
              //
              //     encrypted_content: rp.signature,
              //   };
              //
              //   if (rp.summary) {
              //     reasoningItem.summary = [{ type: "summary_text", text: rp.summary }];
              //   }
              //
              //   if (rp.text) {
              //     reasoningItem.content = [{ type: "reasoning_text", text: rp.text }];
              //   }
              //
              //   items.push(reasoningItem as unknown as OpenAI.Responses.ResponseInputItem);
              // }

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

                if (part.type === "compaction") {
                  flushAssistantText();
                  items.push({
                    type: "compaction",
                    id: part.id,
                    encrypted_content: part.encrypted_content,
                  } as unknown as OpenAI.Responses.ResponseInputItem);
                }
              }

              flushAssistantText();

              break;
            }
          }
        }

        // Track streaming content parts
        const contentParts: Content[] = [];
        let currentType: "reasoning" | "text" | null = null;

        // Helper to append text content
        const appendText = (delta: string) => {
          if (currentType === "text" && contentParts.length > 0) {
            const lastPart = contentParts[contentParts.length - 1];
            if (lastPart.type === "text") {
              lastPart.text += delta;
            }
          } else {
            contentParts.push({ type: "text", text: delta });
            currentType = "text";
          }
          handler?.([...contentParts]);
        };

        // Helper to append reasoning content (text or summary)
        const appendReasoning = (id: string, delta: string, summary?: string) => {
          let reasoningPart = contentParts.find((p): p is ReasoningContent => p.type === "reasoning");
          if (!reasoningPart) {
            reasoningPart = { type: "reasoning", id, text: "" };
            contentParts.unshift(reasoningPart); // Reasoning goes first
          }
          if (summary) {
            reasoningPart.summary = (reasoningPart.summary || "") + summary;
          }
          if (delta) {
            reasoningPart.text += delta;
          }
          currentType = "reasoning";
          handler?.([...contentParts]);
        };

        const runner = this.oai.responses
          .stream({
            model: model,
            store: false,
            tools: this.toTools(tools),
            input: items,
            instructions: instructions,
            ...(options?.effort
              ? {
                  include: ["reasoning.encrypted_content"],
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
            ...(options?.compactThreshold
              ? {
                  context_management: [{ type: "compaction" as const, compact_threshold: options.compactThreshold }],
                }
              : {}),
          })
          .on("response.reasoning_summary_text.delta", (event) => {
            appendReasoning(event.item_id, "", event.delta);
          })
          .on("response.reasoning_text.delta", (event) => {
            appendReasoning(event.item_id, event.delta);
          })
          .on("response.output_text.delta", (event) => {
            appendText(event.delta);
          })
          .on("response.output_item.done", (event) => {
            if (event.item.type === "function_call") {
              contentParts.push({
                type: "tool_call",
                id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments,
              });
              currentType = null;
              handler?.([...contentParts]);
            } else if (event.item.type === "reasoning") {
              // Capture encrypted_content signature for multi-turn conversations
              const encryptedContent = (event.item as { encrypted_content?: string }).encrypted_content;
              if (encryptedContent) {
                // Find the reasoning part and add the signature
                const reasoningPart = contentParts.find((p) => p.type === "reasoning");
                if (reasoningPart && reasoningPart.type === "reasoning") {
                  reasoningPart.signature = encryptedContent;
                  handler?.([...contentParts]);
                }
              }
            } else if (event.item.type === "compaction") {
              const compactionItem = event.item as { id: string; encrypted_content: string };
              console.log("[Compaction] Context compacted", {
                id: compactionItem.id,
                bytes: compactionItem.encrypted_content.length,
              });
              contentParts.push({
                type: "compaction",
                id: compactionItem.id,
                encrypted_content: compactionItem.encrypted_content,
              });
              handler?.([...contentParts]);
            }
          });

        // If a signal was provided, wire it up to abort the runner
        if (options?.signal) {
          options.signal.addEventListener("abort", () => runner.abort(), { once: true });
        }

        try {
          const finalResponse = await runner.finalResponse();

          return {
            result: { role: Role.Assistant, content: contentParts } as Message,
            response: {
              id: finalResponse.id,
              model: finalResponse.model,
              inputTokens: finalResponse.usage?.input_tokens,
              outputTokens: finalResponse.usage?.output_tokens,
            },
          };
        } catch (error) {
          // On abort, return partial content accumulated so far
          if (options?.signal?.aborted) {
            return {
              result: { role: Role.Assistant, content: contentParts } as Message,
              response: { id: "", model },
            };
          }
          throw error;
        }
      },
      { effort: options?.effort, verbosity: options?.verbosity, toolCount: tools?.length },
    ); // end traceGenAI
  }

  async summarizeTitle(model: string, input: Message[]): Promise<string | null> {
    const history = input.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    const result = await this.parse(
      model,
      instructionsSummarizeTitle,
      JSON.stringify(history),
      z.object({ title: z.string() }).strict(),
      "summarize_title",
    );
    return result?.title ?? null;
  }

  async relatedPrompts(model: string, prompt: string): Promise<string[]> {
    const result = await this.parse(
      model,
      instructionsRelatedPrompts,
      prompt || "No input",
      z
        .object({
          prompts: z
            .array(z.object({ prompt: z.string() }).strict())
            .min(3)
            .max(10),
        })
        .strict(),
      "list_prompts",
    );
    return result?.prompts.map((p) => p.prompt) ?? [];
  }

  async extractUrl(model: string, text: string): Promise<string | null> {
    if (!text.trim()) return null;
    const result = await this.parse(
      model,
      "Extract a valid URL from the given text. If the text contains a URL, extract it. If no valid URL is found, return null.",
      text,
      z.object({ url: z.string().nullable() }).strict(),
      "extract_url",
    );
    return result?.url ?? null;
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

  async segmentText(blob: Blob): Promise<string[]> {
    const result = await (await this.post("/api/v1/segment", { file: blob })).json();
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
    if (input instanceof Blob && input.size > 10 * 1024 * 1024) {
      throw new Error(`File size ${(input.size / 1024 / 1024).toFixed(1)}MB exceeds the maximum limit of 10MB`);
    }
    if (typeof input === "string" && input.length > 50000) {
      throw new Error(
        `Text length ${input.length.toLocaleString()} characters exceeds the maximum limit of 50,000 characters`,
      );
    }

    const data = new FormData();
    data.append("lang", lang);
    const headers: HeadersInit = {};

    if (input instanceof Blob) {
      data.append("file", input);
      headers["Accept"] = input.type || "application/octet-stream";
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

  async speakText(model: string, input: string, voice?: string): Promise<void> {
    const audioBlob = await this.generateAudio(model, input, voice);
    const audioUrl = URL.createObjectURL(audioBlob);

    const audio = new Audio(audioUrl);

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };

      audio.onerror = (error) => {
        URL.revokeObjectURL(audioUrl);
        reject(new Error(`Audio playback failed: ${error}`));
      };

      audio.play().catch(reject);
    });
  }

  async transcribe(model: string, blob: Blob): Promise<string> {
    const extension = mime.getExtension(blob.type) || "audio";
    const file = new File([blob], `audio_recording.${extension}`, { type: blob.type });
    const result = await (await this.post("/api/v1/audio/transcriptions", { file, ...(model && { model }) })).json();
    return result.text || "";
  }

  async search(
    model: string,
    query: string,
    options?: { domains?: string[]; limit?: number },
  ): Promise<SearchResult[]> {
    const fields: Record<string, string | Blob> = {
      ...(model && { model }),
      query,
      limit: String(options?.limit ?? 10),
    };

    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    for (const domain of options?.domains ?? []) data.append("domain", domain);

    const resp = await this.postRaw("/api/v1/search", data);
    const results = await resp.json();
    if (!Array.isArray(results)) return [];

    return results.map((result: SearchResult) => {
      let content = simplifyMarkdown(result.content || "");
      if (content.length > 10000) content = content.slice(0, 10000) + "... [truncated]";
      return { source: result.source, title: result.title, content, metadata: result.metadata };
    });
  }

  async research(model: string, instructions: string): Promise<string> {
    const result = await (await this.post("/api/v1/research", { ...(model && { model }), instructions })).json();
    return result.content || "";
  }

  async generateImage(model: string, prompt: string, images?: Blob[]): Promise<Blob> {
    const data = new FormData();
    data.append("input", prompt);
    if (model) data.append("model", model);
    images?.forEach((blob, i) => {
      data.append("file", blob, `image_${i}.${mime.getExtension(blob.type) || "image"}`);
    });
    return (await this.postRaw("/api/v1/render", data)).blob();
  }

  private toTools(tools: Tool[]): OpenAI.Responses.Tool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: "function",

      name: tool.name,
      description: tool.description,

      strict: false,
      parameters: tool.parameters,
    }));
  }

  private sanitizeMessages(messages: Message[]): Message[] {
    // Extract tool result IDs from all messages
    const toolResultIds = new Set(
      messages.flatMap((m) =>
        m.content.filter((p): p is ToolResultContent => p.type === "tool_result").map((p) => p.id),
      ),
    );

    // Find tool calls that have matching results
    const validToolCallIds = new Set(
      messages.flatMap((m) =>
        m.content
          .filter(
            (p): p is import("../types/chat").ToolCallContent => p.type === "tool_call" && toolResultIds.has(p.id),
          )
          .map((p) => p.id),
      ),
    );

    return messages.filter((m) => {
      const toolCalls = m.content.filter((p): p is import("../types/chat").ToolCallContent => p.type === "tool_call");
      const toolResults = m.content.filter((p): p is ToolResultContent => p.type === "tool_result");

      // If message has tool calls, all must have valid results
      if (toolCalls.length > 0) {
        return toolCalls.every((tc) => validToolCallIds.has(tc.id));
      }

      // If message has tool results, all must match valid tool calls
      if (toolResults.length > 0) {
        return toolResults.every((tr) => validToolCallIds.has(tr.id));
      }

      // Keep messages with meaningful content (text, images, files)
      const hasContent = m.content.some(
        (p) => (p.type === "text" && p.text.trim()) || p.type === "image" || p.type === "file",
      );
      return hasContent;
    });
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

  // biome-ignore lint: zod schema type is complex
  private async parse<T extends z.ZodType<any>>(
    model: string,
    instructions: string,
    input: string,
    schema: T,
    name: string,
  ): Promise<z.infer<T> | null> {
    return traceGenAI(name, model, async () => {
      try {
        const response = await this.oai.responses.parse({
          model,
          instructions,
          input,
          text: { format: zodTextFormat(schema, name) },
        });
        return { result: response.output_parsed ?? null };
      } catch (error) {
        console.error(`Error in ${name}:`, error);
        return { result: null };
      }
    });
  }

  private async post(path: string, fields: Record<string, string | Blob>): Promise<Response> {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v instanceof Blob) data.append(k, v);
      else data.append(k, v);
    }
    return this.postRaw(path, data);
  }

  private async postRaw(path: string, data: FormData, headers?: HeadersInit): Promise<Response> {
    const resp = await fetch(new URL(path, window.location.origin), {
      method: "POST",
      headers,
      body: data,
    });
    if (!resp.ok) throw new Error(`${path} failed with status ${resp.status}`);
    return resp;
  }
}
