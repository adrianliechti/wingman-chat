import type { Elicitation, ElicitationResult } from "./elicitation.ts";
import type { AgentContext } from "./telemetry";

export type ToolIcon = React.ComponentType<React.SVGProps<SVGSVGElement>> | string;

export type ModelType = "completer" | "embedder" | "renderer" | "reranker" | "synthesizer" | "transcriber";

export type Model = {
  id: string;
  name: string;

  type?: ModelType;
  description?: string;

  instructions?: string;

  hidden?: boolean;

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
  title?: string;
  description?: string;
  icon?: string;

  parameters: Record<string, unknown>;

  function: (
    args: Record<string, unknown>,
    context?: ToolContext,
  ) => Promise<(TextContent | ImageContent | AudioContent | FileContent)[]>;

  /**
   * Optional, tool-owned presentation for how a call renders in chat. Colocating
   * it with the tool keeps the chat renderer generic; every hook is optional and
   * falls back to a sensible default. See {@link ToolDisplay}.
   */
  display?: ToolDisplay;
};

/** A type icon for a tool's chat presentation (e.g. a lucide icon component). */
export type ToolDisplayIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

export type ToolDisplayState = { running?: boolean; error?: boolean };

/** A code/text block rendered in a tool call's expanded view. */
export type ToolDisplayBlock = {
  code: string;
  language: string;
  /** Optional caption for the block (e.g. "Arguments", "Result", "Instructions"). */
  name?: string;
};

/**
 * How a tool call renders in chat. Every hook is optional and falls back to the
 * generic default (name-cased label, argument preview, JSON result), so a tool
 * overrides only what it cares about.
 */
export type ToolDisplay = {
  /** Collapsed/running header; return only the fields that differ from the defaults. */
  header?: (
    args: Record<string, unknown> | null,
    state: ToolDisplayState,
  ) => {
    icon?: ToolDisplayIcon;
    label?: string;
    mono?: boolean;
    /** Short text shown beside the label; overrides the generic argument preview. */
    preview?: string;
    /** Hide the preview entirely (the label already carries the detail). */
    suppressPreview?: boolean;
  };
  /** Expanded input blocks; return `[]` to hide input, omit to fall back to generic arguments. */
  input?: (args: Record<string, unknown> | null) => ToolDisplayBlock[];
  /** Expanded success output; return `null` to fall back to generic result rendering. */
  output?: (result: Content[]) => ToolDisplayBlock | null;
};

export interface RenderedAppHandle {
  iframe: HTMLIFrameElement;
  registerCleanup(cleanup: () => Promise<void> | void): void;
}

export interface ToolContext {
  model?: string;
  signal?: AbortSignal;
  content?(): Content[];
  elicit?(elicitation: Elicitation): Promise<ElicitationResult>;
  onElicitationComplete?(elicitationId: string): void;
  render?(): Promise<RenderedAppHandle>;
  sendMessage?(message: Message): Promise<void>;
  setMeta?(meta: Record<string, unknown>): void;
  updateMeta?(meta: Record<string, unknown>): void;
  setError?(error: MessageError): void;
  setContent?(content: Record<string, unknown>): void;
  setContext?(text: string | null): Promise<void>;
  /** Trace context for nested agents spawned from this tool. */
  agentContext?: AgentContext;
}

// Content parts for messages - order matters
export type ReasoningContent = {
  type: "reasoning";
  id: string;
  text: string;
  summary?: string;
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
  content?: Record<string, unknown>;
};

export type SummaryContent = {
  type: "summary";
  text: string;
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
  | SummaryContent;

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
