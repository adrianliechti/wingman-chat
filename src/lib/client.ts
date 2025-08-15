import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

import { Tool } from "../types/chat";
import { Message, Model, Role, AttachmentType } from "../types/chat";
import { SearchResult } from "../types/search";

export class Client {
  private oai: OpenAI;

  constructor(apiKey: string = "sk-") {
    this.oai = new OpenAI({
      baseURL: new URL("/api/v1", window.location.origin).toString(),
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  async listModels(): Promise<Model[]> {
    const models = await this.oai.models.list();
    return models.data.map((model) => ({
      id: model.id,
      name: model.id,
    }));
  }

  async complete(model: string, instructions: string, input: Message[], tools: Tool[], handler?: (delta: string, snapshot: string) => void): Promise<Message> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (instructions) {
      messages.push({
        role: "system",
        content: [{ type: "text", text: instructions }],
      });
    }

    for (const m of input) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [];

      if (m.content) {
        content.push({ type: "text", text: m.content });
      }

      for (const a of m.attachments ?? []) {
        if (a.type === AttachmentType.Text) {
          content.push({
            type: "text",
            text: "````text\n// " + a.name + "\n" + a.data + "\n````",
          });
        }

        if (a.type === AttachmentType.File) {
          content.push({
            type: "file",
            file: { file_data: a.data },
          });
        }

        if (a.type === AttachmentType.Image) {
          content.push({
            type: "image_url",
            image_url: { url: a.data },
          });
        }
      }

      switch (m.role) {
        case Role.User:
          messages.push({
            role: Role.User,
            content: content,
          });
          break;

        case Role.Assistant:
          messages.push({
            role: Role.Assistant,
            content: content.filter((c) => c.type === "text"),
          });
          break;
      }
    }

    const stream = this.oai.chat.completions.stream({
      model: model,

      tools: this.toTools(tools),
      messages: messages,

      stream: true,
      stream_options: { include_usage: true },
    });

    if (handler) {
      stream.on("content", handler);
    }

    let completion = await stream.finalChatCompletion() as OpenAI.ChatCompletion;
    messages.push(completion.choices[0].message);

    while (completion.choices[0].message?.tool_calls?.length ?? 0 > 0) {
      for (const toolCall of completion.choices[0].message.tool_calls ?? []) {
        // Type guard to ensure we're working with a function tool call
        if (toolCall.type !== 'function') {
          continue;
        }

        const tool = tools.find((t) => t.name === toolCall.function.name);

        if (!tool) {
          messages.push({
            tool_call_id: toolCall.id,

            role: "tool",
            content: `Error: Tool "${toolCall.function.name}" not found or not executable.`,
          });

          continue;
        }

        try {
          const args = JSON.parse(toolCall.function.arguments || "{}");
          const result = await tool.function(args);

          messages.push({
            role: "tool",
            content: result,

            tool_call_id: toolCall.id,
          });
        }
        catch (error) {
          console.error("Tool failed", error);

          messages.push({
            role: "tool",
            content: "error: tool execution failed.",

            tool_call_id: toolCall.id,
          });
        }
      }

      completion = await this.oai.chat.completions.create({
        model: model,

        tools: this.toTools(tools),
        messages: messages,
      });

      messages.push(completion.choices[0].message);
    }

    const message = completion.choices[0].message;

    return {
      role: Role.Assistant,

      content: message.content ?? "",
      refusal: message.refusal ?? "",
    };
  }

  async summarize(model: string, input: Message[]): Promise<string> {
    const history = input
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\\n");

    const completion = await this.oai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: `Summarize the following conversation into a short title (less than 10 words). Return only the title itself, without any introductory phrases, explanations, or quotation marks.\n\nConversation:\n${history}`,
        },
      ]
    });

    return completion.choices[0].message.content?.trim() ?? "Summary not available";
  }

  async relatedPrompts(model: string, prompt: string): Promise<string[]> {
    const Schema = z.object({
      prompts: z.array(z.object({
        prompt: z.string(),
      }).strict()).min(3).max(10),
    }).strict();

    if (!prompt) {
      prompt = "No conversation history provided. Please suggest interesting prompts to start a new conversation.";
    }

    try {
      const completion = await this.oai.chat.completions.parse({
        model: model,
        messages: [
          {
            role: "system",
            content: `Based on the conversation history provided, generate 3-5 related follow-up prompts that would help the user explore the topic more deeply. The prompts should be:

- From the user's point of view 
- Specific and actionable
- Build upon the current conversation context
- Encourage deeper exploration or different perspectives
- Be concise but clear (maximal 15 words each)
- Vary in type (clarifying questions, requests for examples, deeper analysis, practical applications, etc.)

Return only the prompts themselves, without numbering or bullet points.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: zodResponseFormat(Schema, "list_prompts"),
      });

      const list = completion.choices[0].message.parsed;
      return list?.prompts.map((p) => p.prompt) ?? [];
    } catch (error) {
      console.error("Error generating related prompts:", error);
      return [];
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
      return resp.text();
    }
    
    return resp.blob();
  }

  async speakText(model: string, input: string, voice?: string): Promise<void> {
    if (!input.trim()) {
      return;
    }

    const response = await this.oai.audio.speech.create({
      model: model,
      input: input,

      instructions: "Speak in a clear and natural tone.",

      voice: voice ?? "",
      response_format: "wav",
    });

    const audioBuffer = await response.arrayBuffer();      
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
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
    data.append('file', blob);

    if(model) {
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

  async search(query: string): Promise<SearchResult[]> {
    const data = new FormData();
    data.append('query', query);

    const response = await fetch(new URL(`/api/v1/retrieve`, window.location.origin), {
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

  private toTools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,

        strict: true,
        parameters: tool.parameters,
      },
    }));
  }
}