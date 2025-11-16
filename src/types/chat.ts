import type { File } from "./file";

export type Model = {
    id: string;
    name: string;

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
    description?: string;

    url: string;
};

export type ToolProvider = {
    id: string;
    
    name: string;
    description?: string;

    instructions?: string;

    tools: Tool[];
};

export type Tool = {
    name: string;
    description: string;

    parameters: Record<string, unknown>;

    function: (args: Record<string, unknown>, context?: ToolContext) => Promise<string>;
}

export interface ToolContext {
    attachments?(): Attachment[];
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