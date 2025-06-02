import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { Tool } from "../models/chat";
import { Message, Model, Role, AttachmentType } from "../models/chat";

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

  async complete(model: string, tools: Tool[], input: Message[], handler?: (delta: string, snapshot: string) => void): Promise<Message> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const m of input) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [];

      if (m.content) {
        content.push({ type: "text", text: m.content });
      }

      for (const a of m.attachments ?? []) {
        if (a.type === AttachmentType.Text) {
          content.push({
            type: "text",
            text: a.name + ":\n```" + a.data + "\n```",
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

    const stream = this.oai.beta.chat.completions.stream({
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
      model: model,

      content: message.content ?? "",
      refusal: message.refusal ?? "",

      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
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
    const Prompt = z.object({
      prompt: z.string(),
    });

    const PromptList = z.object({
      prompts: z.array(Prompt),
    });

    const completion = await this.oai.beta.chat.completions.parse({
      model: model,
      messages: [
        {
          role: "system",
          content: `return related prompt suggestions to deep dive into the topic.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: zodResponseFormat(PromptList, "list"),
    });

    const list = completion.choices[0].message.parsed;
    return list?.prompts.map((p) => p.prompt) ?? [];
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

  async captureScreenshot(url: string): Promise<Blob> {
    const data = new FormData();
    data.append("url", url);
    data.append("format", "image");

    const resp = await fetch(new URL("/api/v1/extract", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Extract request failed with status ${resp.status}`);
    }

    return resp.blob();
  }

  async translate(lang: string, text: string): Promise<string> {
    const data = new FormData();
    data.append("lang", lang);
    data.append("text", text);

    const resp = await fetch(new URL("/api/v1/translate", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Translate request failed with status ${resp.status}`);
    }

    return resp.text();
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