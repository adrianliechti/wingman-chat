import type { Elicitation, ElicitationResult } from "./elicitation.ts";

export type ToolIcon = React.ComponentType<React.SVGProps<SVGSVGElement>> | string;

export type ModelType = "completer" | "embedder" | "renderer" | "reranker" | "synthesizer" | "transcriber";

export type Model = {
  id: string;
  name: string;

  type?: ModelType;
  description?: string;

  effort?: "none" | "minimal" | "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
  verbosity?: "low" | "medium" | "high";
  compactThreshold?: number;

  tools?: {
    enabled: string[];
    disabled: string[];
  };
};

export type MCP = {
  id: string;

  name: string;
  description: string;

  url: string;

  icon?: string;
  headers?: Record<string, string>;
};

export const ProviderState = {
  Disconnected: "disconnected",
  Initializing: "initializing",
  Authenticating: "authenticating",
  Connected: "connected",
  Failed: "failed",
} as const;
export type ProviderState = (typeof ProviderState)[keyof typeof ProviderState];

export interface ToolProvider {
  readonly id: string;

  readonly name: string;
  readonly icon?: ToolIcon;
  readonly description?: string;

  readonly instructions?: string;

  readonly tools: Tool[];
}

export type Tool = {
  name: string;
  description: string;
  icon?: string;

  parameters: Record<string, unknown>;

  function: (
    args: Record<string, unknown>,
    context?: ToolContext,
  ) => Promise<(TextContent | ImageContent | AudioContent | FileContent)[]>;
};

export interface RenderedAppHandle {
  iframe: HTMLIFrameElement;
  registerCleanup(cleanup: () => Promise<void> | void): void;
}

export interface ToolContext {
  content?(): Content[];
  elicit?(elicitation: Elicitation): Promise<ElicitationResult>;
  onElicitationComplete?(elicitationId: string): void;
  render?(): Promise<RenderedAppHandle>;
  sendMessage?(message: Message): Promise<void>;
  setMeta?(meta: Record<string, unknown>): void;
  updateMeta?(meta: Record<string, unknown>): void;
  setContext?(text: string | null): Promise<void>;
}

// Content parts for messages - order matters
export type ReasoningContent = {
  type: "reasoning";
  id: string;
  text: string;
  summary?: string;
  signature?: string; // Encrypted reasoning content for multi-turn conversations
};

export type ToolCallContent = {
  type: "tool_call";
  id: string;
  name: string;
  arguments: string;
};

export type ToolResultContent = {
  type: "tool_result";
  id: string;
  name: string;
  arguments: string;
  meta?: Record<string, unknown>;
  result: (TextContent | ImageContent | AudioContent | FileContent)[];
};

export type CompactionContent = {
  type: "compaction";
  id: string;
  encrypted_content: string;
};

// Content is the union of all content types used in messages
export type Content =
  | TextContent
  | ImageContent
  | AudioContent
  | FileContent
  | ReasoningContent
  | ToolCallContent
  | ToolResultContent
  | CompactionContent;

export type TextContent = {
  type: "text";

  text: string;
};

export type ImageContent = {
  type: "image";

  name?: string;
  data: string; // Full data URL (data:mime;base64,...)
};

export type AudioContent = {
  type: "audio";

  name?: string;
  data: string; // Full data URL (data:mime;base64,...)
};

export type FileContent = {
  type: "file";

  name: string;
  data: string; // Full data URL (data:mime;base64,...)
};

export type Message = {
  role: "user" | "assistant";

  /** Ordered content parts (text, reasoning, tool_call, tool_result, images, files) */
  content: Content[];

  error?: MessageError | null;
};

export type MessageError = {
  code: string;
  message: string;
};

export const Role = {
  User: "user",
  Assistant: "assistant",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export type Chat = {
  id: string;
  title?: string;
  customTitle?: string;
  customIndex?: number;

  created: Date | null;
  updated: Date | null;

  model: Model | null;
  messages: Array<Message>;
};

// Helper function to extract text from content parts
export function getTextFromContent(content: Content[]): string {
  return content
    .filter((p): p is TextContent => p.type === "text")
    .map((p) => p.text)
    .join("");
}
