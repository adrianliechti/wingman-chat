import OpenAI from "openai";

import {
  Message,
  Model,
  Role,
  Partition,
  AttachmentType,
} from "../models/chat";

const client = new OpenAI({
  baseURL: new URL("/api/v1", window.location.origin).toString(),
  apiKey: "sk-",
  dangerouslyAllowBrowser: true,
});

export async function listModels(): Promise<Model[]> {
  const models = await client.models.list();

  return models.data.map((model) => {
    return {
      id: model.id,
      name: model.id,
    };
  });
}

export const textTypes = [
  "text/csv",
  "text/markdown",
  "text/plain",

  "application/json",
  "application/sql",
  "application/toml",
  "application/x-yaml",
  "application/xml",
  "text/css",
  "text/html",
  "text/xml",
  "text/yaml",

  ".c",
  ".cpp",
  ".cs",
  ".go",
  ".html",
  ".java",
  ".js",
  ".kt",
  ".py",
  ".rs",
  ".ts",
];

export const imageTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export const partitionTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const supportedTypes = [...textTypes, ...imageTypes, ...partitionTypes];

export async function partition(blob: Blob): Promise<Partition[]> {
  const data = new FormData();
  data.append("files", blob);

  const resp = await fetch("/api/v1/partition", {
    method: "POST",
    headers: {
      accept: "application/json",
    },
    body: data,
  });

  return resp.json() as Promise<Partition[]>;
}

export async function complete(
  model: string,
  input: Message[],
  handler?: (delta: string, snapshot: string) => void
): Promise<Message> {
  const messages = [];

  for (const m of input) {
    const content = [];

    if (m.content) {
      content.push({ type: "text", text: m.content });
    }

    for (const a of m.attachments ?? []) {
      if (a.type == AttachmentType.Text) {
        content.push({
          type: "text",
          text: a.name + ":\n```" + a.data + "\n```",
        });
      }

      if (a.type == AttachmentType.File) {
        content.push({
          type: "file_url",
          file_url: {
            url: a.data,
          },
        });
      }

      if (a.type == AttachmentType.Image) {
        content.push({
          type: "image_url",
          image_url: {
            url: a.data,
          },
        });
      }
    }

    messages.push({
      role: m.role as OpenAI.Chat.ChatCompletionRole,
      content: content,
    });
  }

  const stream = client.beta.chat.completions.stream({
    model: model,
    stream: true,

    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
  });

  stream.on("content", (delta, snapshot) => {
    if (handler) {
      handler(delta, snapshot);
    }
  });

  const completion = await stream.finalChatCompletion();

  const result = {
    role: Role.Assistant,
    content: completion.choices[0].message.content ?? "",
  };

  return result;
}

export async function summarize(
  model: string,
  input: Message[]
): Promise<string> {
  const history = input
    .slice(-6)
    .map((m) => m.content)
    .join("\n");

  const completion = await client.chat.completions.create({
    model: model,
    messages: [
      {
        role: "user",
        content: `Your Task is to summarize the conversation to a short title.\nReturn only the title without explaination or quotes:\n${history}`,
      },
    ],
  });

  return completion.choices[0].message.content ?? "";
}
