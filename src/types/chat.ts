import type { File } from "./file";

export type Model = {
    id: string;
    name: string;
    
    description?: string;
    
    prompts?: string[];
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

export type MessageError = {
    code: string;
    message: string;
};

export type Message = {
    role: 'user' | 'assistant' | 'tool';

    content: string;

    attachments?: Attachment[];
    
    error?: MessageError | null;

    toolCalls?: ToolCall[];
    toolResult?: ToolResult;
};

export enum Role {
    User = "user",
    Assistant = "assistant",
    Tool = "tool",
}

export type Tool = {
    name: string;
    description: string;

    parameters: Record<string, unknown>;

    function: (args: Record<string, unknown>) => Promise<string>;
}

export enum AttachmentType {
    Text = "text",
    File = "file_data",
    Image = "image_data",
  }

export type Attachment = {
    type: AttachmentType;
    name: string;

    data: string;
    meta?: Record<string, unknown>;
};

export type Chat = {
    id: string;
    title?: string;

    created: Date | null;
    updated: Date | null;

    model: Model | null;
    messages: Array<Message>;
    artifacts?: { [path: string]: File };
};