export type Model = {
    id: string;
    name: string;
    
    description?: string;
}

export type Message = {
    role: 'user' | 'assistant';

    content: string;
    refusal?: string;

    inputTokens?: number
    outputTokens?: number

    attachments?: Attachment[];
};

export enum Role {
    User = "user",
    Assistant = "assistant",
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
};

export type Chat = {
    id: string;
    title?: string;

    created: Date | null;
    updated: Date | null;

    model: Model | null;
    messages: Array<Message>;
};