import { z } from "zod/v3";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import mime from "mime";

import { Role, AttachmentType } from "../types/chat";
import type { Tool, ToolCall } from "../types/chat";
import type { Message, Model, ModelType } from "../types/chat";
import type { SearchResult } from "../types/search";
import { modelType, modelName } from "./models";

import instructionsConvertCsv from "../prompts/convert-csv.txt?raw";
import instructionsConvertMd from "../prompts/convert-md.txt?raw";
import instructionsRelatedPrompts from "../prompts/chat-suggestions.txt?raw";
import instructionsRewriteSelection from "../prompts/rewrite-selection.txt?raw";
import instructionsRewriteText from "../prompts/rewrite-text.txt?raw";
import instructionsSummarizeTitle from "../prompts/chat-title.txt?raw";

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
    handler?: (delta: string, snapshot: string) => void
  ): Promise<Message> {
    const inputMessages2: OpenAI.Responses.ResponseInputItem[] = [];

    for (const m of input) {
      switch (m.role) {
        case Role.User: {
          const content: OpenAI.Responses.ResponseInputContent[] = [];

          if (m.content) {
            content.push({ type: "input_text", text: m.content });
          }

          for (const a of m.attachments ?? []) {
            if (a.type === AttachmentType.Text) {
              content.push({
                type: "input_text",
                text: "````text\n// " + a.name + "\n" + a.data + "\n````",
              });
            }

            if (a.type === AttachmentType.File) {
              content.push({
                type: "input_file",
                file_data: a.data,
              });
            }

            if (a.type === AttachmentType.Image) {
              content.push({
                type: "input_image",
                image_url: a.data,
                detail: "auto",
              });
            }
          }

          inputMessages2.push({
            type: "message",
            role: "user",
            content: content,
          });

          break;
        }

        case Role.Tool: {
          if (m.toolResult) {
            inputMessages2.push({
              type: "function_call_output",
              call_id: m.toolResult.id,
              output: m.content,
            });
          }

          break;
        }

        case Role.Assistant: {
          if (m.toolCalls && m.toolCalls.length > 0) {
            for (const tc of m.toolCalls) {
              inputMessages2.push({
                type: "function_call",
                call_id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              });
            }
          } else {
            inputMessages2.push({
              type: "message",
              role: "assistant",
              content: m.content,
            });
          }

          break;
        }
      }
    }

    const runner = this.oai.responses
      .stream({
        model: model,
        tools: this.toTools(tools),
        input: inputMessages2,
        instructions: instructions,
      });

    if (handler) {
      let snapshot = "";

      runner.on('response.output_text.delta', (event) => {
        const delta = event.delta;
        snapshot += delta;
        handler(delta, snapshot);
      });
    }

    const response = await runner.finalResponse();

    if (!response.output) {
      return {
        role: Role.Assistant,
        content: "",
      };
    }

    console.log("response:", response);
    console.log("response text:", response.output_text);

    // Extract message and tool calls from response
    let content = "";
    const toolCalls: Array<ToolCall> = [];

    for (const item of response.output) {
      if (item.type === "message") {
        if (item.content) {
          for (const part of item.content) {
            if (part.type === "output_text") {
              content = part.text;
            }
          }
        }
      } else if (item.type === "function_call") {
        if (item.call_id) {
          toolCalls.push({
            id: item.call_id,
            name: item.name,
            arguments: item.arguments,
          });
        }
      }
    }

    return {
      role: Role.Assistant,
      content: content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async summarizeTitle(model: string, input: Message[]): Promise<string | null> {
    const Schema = z.object({
      title: z.string(),
    }).strict();

    const history = input
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const response = await this.oai.responses.parse({
        model: model,
        instructions: instructionsSummarizeTitle,
        input: JSON.stringify(history),
        text: {
          format: zodTextFormat(Schema, "summarize_title"),
        },
      });

      const result = response.output_parsed;
      return result?.title ?? null;
    } catch (error) {
      console.error("Error generating title:", error);
      return null;
    }
  }

  async relatedPrompts(model: string, prompt: string): Promise<string[]> {
    const Schema = z.object({
      prompts: z.array(z.object({
        prompt: z.string(),
      }).strict()).min(3).max(10),
    }).strict();

    try {
      const response = await this.oai.responses.parse({
        model: model,
        instructions: instructionsRelatedPrompts,
        input: prompt || "No input",
        text: {
          format: zodTextFormat(Schema, "list_prompts"),
        },
      });

      const list = response.output_parsed;
      return list?.prompts.map((p) => p.prompt) ?? [];
    } catch (error) {
      console.error("Error generating related prompts:", error);
      return [];
    }
  }

  async extractUrl(model: string, text: string): Promise<string | null> {
    const Schema = z.object({
      url: z.string().nullable(),
    }).strict();

    if (!text.trim()) {
      return null;
    }

    try {
      const response = await this.oai.responses.parse({
        model: model,
        instructions: "Extract a valid URL from the given text. If the text contains a URL, extract it. If no valid URL is found, return null.",
        input: text,
        text: {
          format: zodTextFormat(Schema, "extract_url"),
        },
      });

      const result = response.output_parsed;
      return result?.url ?? null;
    } catch (error) {
      console.error("Error extracting URL:", error);
      return null;
    }
  }

  async convertCSV(model: string, text: string): Promise<string> {
    const Schema = z.object({
      csvData: z.string(),
    }).strict();

    if (!text.trim()) {
      return "";
    }

    try {
      const response = await this.oai.responses.parse({
        model: model,
        instructions: instructionsConvertCsv,
        input: text,
        text: {
          format: zodTextFormat(Schema, "convert_csv"),
        },
      });

      const result = response.output_parsed;
      return result?.csvData ?? "";
    } catch (error) {
      console.error("Error converting to CSV:", error);
      return "";
    }
  }

  async convertMD(model: string, text: string): Promise<string> {
    const Schema = z.object({
      mdData: z.string(),
    }).strict();

    if (!text.trim()) {
      return "";
    }

    try {
      const response = await this.oai.responses.parse({
        model: model,
        instructions: instructionsConvertMd,
        input: text,
        text: {
          format: zodTextFormat(Schema, "convert_md"),
        },
      });

      const result = response.output_parsed;
      return result?.mdData ?? "";
    } catch (error) {
      console.error("Error converting to Markdown:", error);
      return "";
    }
  }

  async rewriteSelection(model: string, text: string, selectionStart: number, selectionEnd: number): Promise<{ alternatives: string[], contextToReplace: string, keyChanges: string[] }> {
    const Schema = z.object({
      alternatives: z.array(z.object({
        text: z.string(),
        keyChange: z.string(),
      }).strict()).min(3).max(6),
    }).strict();

    // Validate input
    if (!text.trim() || selectionStart < 0 || selectionEnd <= selectionStart || selectionStart >= text.length) {
      return {
        alternatives: [],
        contextToReplace: text.substring(selectionStart, selectionEnd),
        keyChanges: []
      };
    }

    // Helper to expand selection to complete sentences
    const expandToSentences = (text: string, start: number, end: number): string => {
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
        const currentStart = boundaries[i];
        const currentEnd = boundaries[i + 1];

        if (currentStart < end && currentEnd > start) {
          sentenceStart = Math.min(sentenceStart === 0 ? currentStart : sentenceStart, currentStart);
          sentenceEnd = Math.max(sentenceEnd === text.length ? currentEnd : sentenceEnd, currentEnd);
        }
      }

      return text.substring(sentenceStart, sentenceEnd).trim();
    };

    const contextToRewrite = expandToSentences(text, selectionStart, selectionEnd);
    const selectedText = text.substring(selectionStart, selectionEnd);

    try {
      const response = await this.oai.responses.parse({
        model: model,
        instructions: instructionsRewriteSelection,
        input: JSON.stringify({
          context: contextToRewrite,
          selection: selectedText
        }),
        text: {
          format: zodTextFormat(Schema, "rewrite_selection"),
        },
      });

      const result = response.output_parsed;
      return {
        alternatives: result?.alternatives.map(a => a.text) ?? [],
        contextToReplace: contextToRewrite,
        keyChanges: result?.alternatives.map(a => a.keyChange) ?? []
      };
    } catch (error) {
      console.error("Error generating text alternatives:", error);
      return {
        alternatives: [],
        contextToReplace: contextToRewrite,
        keyChanges: []
      };
    }
  }

  async extractText(blob: Blob): Promise<string> {
    const data = new FormData();
    data.append("file", blob);
    data.append("format", "text");

    const resp = await fetch(new URL("/api/v1/extract", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Extract request failed with status ${resp.status}`);
    }

    return resp.text();
  }

  async fetchText(url: string): Promise<string> {
    const data = new FormData();
    data.append("url", url);
    data.append("format", "text");

    const resp = await fetch(new URL("/api/v1/extract", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Fetch request failed with status ${resp.status}`);
    }

    return resp.text();
  }

  async segmentText(blob: Blob): Promise<string[]> {
    const data = new FormData();
    data.append("file", blob);

    const resp = await fetch(new URL("/api/v1/segment", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Segment request failed with status ${resp.status}`);
    }

    const result = await resp.json();

    if (!Array.isArray(result)) {
      return [];
    }

    return result.map((item: { text?: string } | string) => {
      if (typeof item === 'string') return item;
      return item.text || '';
    });
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
    // Input validation
    if (input instanceof Blob) {
      // Check file size limit (10MB)
      const maxFileSize = 10 * 1024 * 1024; // 10MB in bytes

      if (input.size > maxFileSize) {
        throw new Error(`File size ${(input.size / 1024 / 1024).toFixed(1)}MB exceeds the maximum limit of 10MB`);
      }
    } else {
      // Check text length limit (50,000 characters)
      const maxTextLength = 50000;

      if (input.length > maxTextLength) {
        throw new Error(`Text length ${input.length.toLocaleString()} characters exceeds the maximum limit of ${maxTextLength.toLocaleString()} characters`);
      }
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

    const resp = await fetch(new URL("/api/v1/translate", window.location.origin), {
      method: "POST",
      headers,
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Translate request failed with status ${resp.status}`);
    }

    const contentType = resp.headers.get("content-type")?.toLowerCase() || "";

    if (contentType.includes("text/plain") || contentType.includes("text/markdown")) {
      const translatedText = await resp.text();
      // Replace German ß with ss automatically
      return translatedText.replace(/ß/g, 'ss');
    }

    return resp.blob();
  }

  async rewriteText(
    model: string,
    text: string,
    lang?: string,
    tone?: string,
    style?: string,
    userPrompt?: string
  ): Promise<string> {
    const Schema = z.object({
      rewrittenText: z.string(),
    }).strict();

    if (!text.trim()) {
      return text;
    }

    // Build tone instruction
    const toneInstruction = !tone ? '' :
      tone === 'enthusiastic' ? 'Use an enthusiastic and energetic tone.' :
        tone === 'friendly' ? 'Use a warm and friendly tone.' :
          tone === 'confident' ? 'Use a confident and assertive tone.' :
            tone === 'diplomatic' ? 'Use a diplomatic and tactful tone.' :
              '';

    // Build style instruction
    const styleInstruction = !style ? '' :
      style === 'simple' ? 'Use simple and clear language.' :
        style === 'business' ? 'Use professional business language.' :
          style === 'academic' ? 'Use formal academic language.' :
            style === 'casual' ? 'Use casual and informal language.' :
              '';

    // Combine predefined instructions
    const predefinedInstructions = [toneInstruction, styleInstruction].filter(Boolean);

    // Build the complete instruction set
    const instructions = [];
    if (predefinedInstructions.length > 0) {
      instructions.push(predefinedInstructions.join(' '));
    }
    if (userPrompt?.trim()) {
      instructions.push(`Custom instruction: ${userPrompt.trim()}`);
    }

    const finalInstructions = instructions.length > 0
      ? instructions.join(' ')
      : 'Maintain the original tone and style';

    // Language handling
    const languageInstruction = lang
      ? `Ensure the text is in ${lang} language${lang !== 'en' ? ', translating if necessary' : ''}.`
      : 'Maintain the original language of the text.';

    try {
      const response = await this.oai.responses.parse({
        model: model,
        instructions: instructionsRewriteText
          .replace('{languageInstruction}', languageInstruction)
          .replace('{finalInstructions}', finalInstructions),
        input: text,
        text: {
          format: zodTextFormat(Schema, "rewrite_text"),
        },
      });

      const result = response.output_parsed;
      let rewrittenText = result?.rewrittenText ?? text;

      // Replace German ß with ss automatically
      rewrittenText = rewrittenText.replace(/ß/g, 'ss');

      return rewrittenText;
    } catch (error) {
      console.error("Error rewriting text:", error);
      return text;
    }
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
    return new Blob([audioBuffer], { type: 'audio/wav' });
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
    const data = new FormData();

    // Get file extension - handle common audio types explicitly
    let extension = 'audio';
    if (blob.type.includes('webm')) {
      extension = 'webm';
    } else if (blob.type.includes('mp3') || blob.type.includes('mpeg')) {
      extension = 'mp3';
    } else if (blob.type.includes('wav')) {
      extension = 'wav';
    } else if (blob.type.includes('ogg')) {
      extension = 'ogg';
    } else if (blob.type.includes('m4a') || blob.type.includes('mp4')) {
      extension = 'm4a';
    } else if (blob.type.includes('flac')) {
      extension = 'flac';
    } else {
      extension = mime.getExtension(blob.type) || 'audio';
    }

    const filename = `audio_recording.${extension}`;

    data.append('file', blob, filename);

    if (model) {
      data.append('model', model);
    }

    const response = await fetch(new URL("/api/v1/audio/transcriptions", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Transcription request failed with status ${response.status}`);
    }

    const result = await response.json();
    return result.text || '';
  }

  async search(query: string, options?: { domains?: string[] }): Promise<SearchResult[]> {
    const data = new FormData();
    data.append('query', query);

    if (options?.domains) {
      for (const domain of options.domains) {
        data.append('domain', domain);
      }
    }

    const response = await fetch(new URL(`/api/v1/search`, window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }

    const results = await response.json();

    if (!Array.isArray(results)) {
      return [];
    }

    return results.map((result: SearchResult) => ({
      title: result.title || undefined,
      source: result.source || undefined,
      content: result.content,
    }));
  }

  async research(instructions: string): Promise<string> {
    const data = new FormData();
    data.append('instructions', instructions);

    const response = await fetch(new URL(`/api/v1/research`, window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Research request failed with status ${response.status}`);
    }

    const result = await response.json();
    return result.content || '';
  }

  async generateImage(
    model: string,
    prompt: string,
    images?: Blob[]
  ): Promise<Blob> {
    try {
      const data = new FormData();
      data.append('input', prompt);

      if (model) {
        data.append('model', model);
      }

      // Add optional image blobs as files
      if (images && images.length > 0) {
        images.forEach((blob, index) => {
          const extension = mime.getExtension(blob.type) || 'image';
          const filename = `image_${index}.${extension}`;

          data.append('file', blob, filename);
        });
      }

      const response = await fetch(new URL(`/api/v1/render`, window.location.origin), {
        method: "POST",
        body: data,
      });

      if (!response.ok) {
        throw new Error(`Image generation request failed with status ${response.status}`);
      }

      return response.blob();
    } catch (error) {
      console.error("Image generation failed:", error);
      throw error;
    }
  }

  private toTools(tools: Tool[]): OpenAI.Responses.Tool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      strict: true,
      parameters: {
        ...tool.parameters,
        additionalProperties: false,
      },
    }));
  }
}
