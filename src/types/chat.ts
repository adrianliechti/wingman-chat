import type { File } from "./file";

export type ToolIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

export type ModelType = "completer" | "embedder" | "renderer" | "reranker" | "synthesizer" | "transcriber";

export type Model = {
    id: string;
    name: string;

    type?: ModelType;
    description?: string;

    tools?: {
        enabled: string[];
        disabled: string[];
    };

    prompts?: string[];
}

export type MCP = {
    id: string;

    name: string;
    description: string;

    url: string;
};

export enum ProviderState {
  Disconnected = 'disconnected',
  Initializing = 'initializing',
  Connected = 'connected',
  Failed = 'failed',
}

export interface ToolProvider {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: ToolIcon;
  readonly instructions?: string;
  readonly tools: Tool[];
}

export type Tool = {
    name: string;
    description: string;

    parameters: Record<string, unknown>;

    function: (args: Record<string, unknown>, context?: ToolContext) => Promise<string>;
}

export type Elicitation = {
    message: string;
};

export type ElicitationResult = {
    action: "accept" | "decline" | "cancel";
};

export type PendingElicitation = {
    toolCallId: string;
    toolName: string;
    elicitation: Elicitation;
    resolve: (result: ElicitationResult) => void;
};

export interface ToolContext {
    attachments?(): Attachment[];
    elicit?(elicitation: Elicitation): Promise<ElicitationResult>;
}

export type ToolCall = {
    id: string;

    name: string;
    arguments: string;
};

export type ToolResult = {
    id: string;

    name: string; // from tool call
    arguments: string; // from tool call

    data: string;
};

export type Message = {
    role: 'user' | 'assistant' | 'tool';

    content: string;

    attachments?: Attachment[];

    error?: MessageError | null;

    toolCalls?: ToolCall[];
    toolResult?: ToolResult;
};

export type MessageError = {
    code: string;
    message: string;
};

export enum Role {
    User = "user",
    Assistant = "assistant",
    Tool = "tool",
}

export type Attachment = {
    type: AttachmentType;
    name: string;

    data: string;
    meta?: Record<string, unknown>;
};

export enum AttachmentType {
    Text = "text",
    File = "file_data",
    Image = "image_data",
}

export type Chat = {
    id: string;
    title?: string;

    created: Date | null;
    updated: Date | null;

    model: Model | null;
    messages: Array<Message>;
    artifacts?: { [path: string]: File };
};