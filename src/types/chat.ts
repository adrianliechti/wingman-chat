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

    headers?: Record<string, string>;
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
    readonly icon?: ToolIcon;
    readonly description?: string;

    readonly instructions?: string;
    
    readonly tools: Tool[];
}

export type Tool = {
    name: string;
    description: string;

    parameters: Record<string, unknown>;

    function: (args: Record<string, unknown>, context?: ToolContext) => Promise<(TextContent | ImageContent | AudioContent | FileContent)[]>;
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
    content?(): Content[];
    elicit?(elicitation: Elicitation): Promise<ElicitationResult>;
    render?(): Promise<HTMLIFrameElement>;
}

// Content parts for messages - order matters
export type ReasoningContent = {
    type: 'reasoning';
    id: string;
    text: string;
    summary?: string;
    signature?: string;  // Encrypted reasoning content for multi-turn conversations
};

export type ToolCallContent = {
    type: 'tool_call';
    id: string;
    name: string;
    arguments: string;
};

export type ToolResultContent = {
    type: 'tool_result';
    id: string;
    name: string;
    arguments: string;
    result: (TextContent | ImageContent | AudioContent | FileContent)[];
};

// Content is the union of all content types used in messages
export type Content = TextContent | ImageContent | AudioContent | FileContent | ReasoningContent | ToolCallContent | ToolResultContent;

export type TextContent = {
    type: "text";
    
    text: string;
}

export type ImageContent = {
    type: "image";

    name?: string;
    data: string;  // Full data URL (data:mime;base64,...)
}

export type AudioContent = {
    type: "audio";

    name?: string;
    data: string;  // Full data URL (data:mime;base64,...)
}

export type FileContent = {
    type: "file";

    name: string;
    data: string;  // Full data URL (data:mime;base64,...)
}

export type Message = {
    role: 'user' | 'assistant';

    /** Ordered content parts (text, reasoning, tool_call, tool_result, images, files) */
    content: Content[];

    error?: MessageError | null;
};

export type MessageError = {
    code: string;
    message: string;
};

export enum Role {
    User = "user",
    Assistant = "assistant",
}

export type Chat = {
    id: string;
    title?: string;

    created: Date | null;
    updated: Date | null;

    model: Model | null;
    messages: Array<Message>;
};

// Helper function to extract text from content parts
export function getTextFromContent(content: Content[]): string {
    return content
        .filter((p): p is TextContent => p.type === 'text')
        .map(p => p.text)
        .join('');
}