import type { ChatMiddleware, ContentPart, SchemaInput, Tool as NativeTool, UIMessage } from "@tanstack/ai";
import type { z } from "zod";
import type { ChatPersistedState } from "@tanstack/ai-client";
import type { Elicitation, ElicitationResult } from "./elicitation.ts";
import type { AgentContext } from "./telemetry";

export type ToolIcon = React.ComponentType<React.SVGProps<SVGSVGElement>> | string;

export type ModelType = "completer" | "embedder" | "renderer" | "reranker" | "realtime" | "synthesizer" | "transcriber";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Image-generation quality tier (renderer models). */
export type ImageQuality = "low" | "medium" | "high" | "xhigh" | "max";
/** Image-generation output resolution (e.g. Gemini's 1K/2K/4K lever). */
export type ImageResolution = "512" | "1K" | "2K" | "4K";
/** Image-generation background mode beyond the default "auto" (which is omitted). */
export type ImageBackground = "opaque" | "transparent";

export type Model = {
  id: string;
  name: string;

  /** Older model IDs whose saved selections should use this model instead. */
  replaces?: string[];

  /** Short subdued text shown inline after `name`, e.g. the underlying model. */
  caption?: string;

  type?: ModelType;
  description?: string;

  instructions?: string;

  hidden?: boolean;

  /**
   * Reasoning effort. In config this is the model's default; on a chat's stored
   * model it doubles as the per-chat override (the config default is recovered
   * from the fresh model list by id). Unset means the backend/model default.
   */
  effort?: ReasoningEffort;
  /** Reasoning-effort levels offered in the picker; empty/unset hides the effort selector. */
  supportedEfforts?: ReasoningEffort[];
  /**
   * The level the picker badges as "Default" — what a fresh chat gets. Config's
   * `effort` when set, else the provider's own default. Never a per-chat override.
   */
  defaultEffort?: ReasoningEffort;
  summary?: "auto" | "concise" | "detailed";
  verbosity?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  outputTokenBudget?: number;
  compactThreshold?: number;

  /**
   * Renderer (image) model capabilities, mirroring `supportedEfforts` for chat:
   * config wins, else a per-family heuristic fills them in. Each drives the
   * matching Canvas picker — an empty/unset list hides that control.
   */
  supportedQualities?: ImageQuality[];
  supportedAspectRatios?: string[];
  /** Output resolutions, for models whose size lever is resolution (e.g. Gemini) rather than a quality tier. */
  supportedResolutions?: ImageResolution[];
  /** Background modes beyond the always-available "auto" default (opaque/transparent). */
  supportedBackgrounds?: ImageBackground[];

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
  Unauthorized: "unauthorized",
} as const;
export type ProviderState = (typeof ProviderState)[keyof typeof ProviderState];

export interface ToolProvider {
  readonly id: string;

  readonly name: string;
  readonly icon?: ToolIcon;
  readonly description?: string;

  readonly instructions?: string;
  /** Request-only metadata appended to the latest human message, outside static instructions. */
  readonly runtimeContext?: string;

  readonly tools: Tool[];

  /** Native chat setup when a provider uses middleware; tools above also serve realtime and display. */
  readonly chat?: {
    tools: Tool[];
    instructions?: string;
    middleware: ChatMiddleware[];
  };
}

type WorkspaceTool = NativeTool<
  z.ZodType<Record<string, unknown>, Record<string, unknown>>,
  z.ZodType<ContentPart[], ContentPart[]>,
  string,
  ToolContext | undefined
>;

/** Native tools with rich workspace results and app-owned presentation. */
export type Tool = Omit<WorkspaceTool, "inputSchema"> & {
  // Providers include native skill schemas and dynamically discovered MCP schemas.
  inputSchema: SchemaInput;
  execute: NonNullable<WorkspaceTool["execute"]>;
  title?: string;
  icon?: string;
  /** Chat uses a native defineAgent; execute remains the realtime tool boundary. */
  subagent?: {
    /** Defaults to the caller's model. */
    model?: string;
    instructions: string;
    tools: Tool[];
    runtimeContext?: string;
    middleware?: ChatMiddleware[];
    /** Research receives its explicit brief instead of the parent conversation. */
    inheritHistory?: boolean;
    /** Optional bounds for a delegated run, including its tools and middleware. */
    maxIterations?: number;
    timeoutMs?: number;
    /** Optional retrieval-only path. Undefined continues with the model loop. */
    direct?: (args: Record<string, unknown>, context: ToolContext) => Promise<string | undefined>;
  };

  /**
   * Optional, tool-owned presentation for how a call renders in chat. Colocating
   * it with the tool keeps the chat renderer generic; every hook is optional and
   * falls back to a sensible default. See {@link ToolDisplay}.
   */
  display?: ToolDisplay;
};

/** A type icon for a tool's chat presentation (e.g. a lucide icon component). */
export type ToolDisplayIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

export type ToolDisplayState = {
  running?: boolean;
  error?: boolean;
  /** Stable identity while arguments stream and the tool runs. */
  toolCallId?: string;
};

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
  output?: (result: ContentPart[]) => ToolDisplayBlock | null;
};

/** Application context passed through native chat middleware and tool execution. */
export interface AgentRunContext {
  signal?: AbortSignal;
  /** A child keeps separate workspace observations and read-only memory access. */
  subagentRunId?: string;
}

export interface ToolContext {
  model?: string;
  chatId?: string;
  runId?: string;
  invocationContext?: AgentRunContext;
  signal?: AbortSignal;
  /** Native chat tools can pause and receive an answer on their resumed execution. */
  interruptible?: boolean;
  inputResponse?: { status: "resolved"; payload: unknown } | { status: "cancelled" };
  /** The content parts of the user turn that triggered this run (text and attachments). */
  content?(): ContentPart[];
  elicit?(elicitation: Elicitation): Promise<ElicitationResult>;
  onElicitationComplete?(elicitationId: string): void;
  setMeta?(meta: Record<string, unknown>): void;
  setError?(error: MessageError): void;
  setContent?(content: Record<string, unknown>): void;
  /** Trace context for nested agents spawned from this tool. */
  agentContext?: AgentContext;
}

export type MessageUsage = {
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  reasoningContext?: "current_turn" | "all_turns";
};

export type MessageError = {
  code: string;
  message: string;
};

/** Namespaced app and middleware state scoped to one chat (e.g. compaction checkpoints). */
export type ChatMetadata = Record<string, Record<string, unknown>>;

/** Native transcript and resume state, plus the application's chat settings. */
export interface Chat extends ChatPersistedState {
  id: string;
  title?: string;
  customTitle?: string;
  customIndex?: number;

  created: Date | null;
  updated: Date | null;

  model: Model | null;
  messages: UIMessage[];
  metadata?: ChatMetadata;
}

/** Sidebar metadata; conversation bodies and attachments are loaded separately. */
export type ChatEntry = Pick<Chat, "id" | "title" | "customTitle" | "customIndex" | "created" | "updated">;
