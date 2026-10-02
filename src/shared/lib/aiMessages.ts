import type { ContentPart, MessagePart, SubagentPart, UIMessage } from "@tanstack/ai";
import type { GatewayTextSegment } from "./gatewayText";
import { serializeToolResultForApi } from "./utils";
import { formatArtifactSelection } from "./artifactSelection";
import { packGatewayReasoning, readGatewayReasoning } from "./reasoning";
import {
  readSignature,
  tagSignature,
  type Content,
  type Message,
  type Signature,
  type ToolResultContent,
} from "../types/chat";

/** Realm tag for state only this runtime can replay. */
const AI_REALM = "tanstack";

/** Runtime-only data as a {@link Signature}; empty data needs none. */
export function aiSignature(data: Record<string, unknown>): Signature | undefined {
  return Object.values(data).some((value) => value !== undefined)
    ? tagSignature(AI_REALM, JSON.stringify(data))
    : undefined;
}

/** Data this runtime signed; another realm's or a corrupt signature reads as absent. */
export function readAISignature<T>(signature: Signature | undefined): T | undefined {
  const data = readSignature(signature, AI_REALM);
  if (!data) return undefined;
  try {
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}

type SubagentRouting = Omit<
  SubagentPart["subagent"],
  "id" | "name" | "description" | "status" | "messages" | "error" | "parentToolCallId" | "parentRunId"
>;

function subagentSignature(subagent: SubagentPart["subagent"]) {
  const {
    id: _id,
    name: _name,
    description: _description,
    status: _status,
    messages: _messages,
    error: _error,
    parentToolCallId: _call,
    parentRunId: _run,
    ...routing
  } = subagent;
  return aiSignature(routing satisfies SubagentRouting);
}

/** Storage/UI boundary. Existing Wingman conversations stay readable; AI state is native TanStack. */
export function toAIMessages(
  messages: Message[],
  model?: string,
  options?: { pendingToolCalls?: boolean },
): UIMessage[] {
  const answeredCalls = new Set(
    messages.flatMap((message) => message.content.flatMap((part) => (part.type === "tool_result" ? [part.id] : []))),
  );
  const converted = messages.map((message): UIMessage => ({
    id: message.id ?? crypto.randomUUID(),
    role: message.role,
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
    metadata: {
      wingman: { runId: message.runId, usage: message.usage, error: message.error },
      wingmanTextSegments: message.content.flatMap((part) =>
        part.type === "text" ? [{ content: part.text, phase: part.phase }] : [],
      ),
      wingmanReasoningModels: Object.fromEntries(
        message.content.flatMap((part) => (part.type === "reasoning" ? [[part.id, part.model]] : [])),
      ),
    },
    parts: message.content.flatMap((part): MessagePart[] => {
      switch (part.type) {
        case "subagent":
          return [
            {
              type: "subagent",
              subagent: {
                ...readAISignature<SubagentRouting>(part.signature),
                id: part.id,
                name: part.name,
                description: part.description,
                parentRunId: part.runId,
                parentToolCallId: part.toolCallId,
                status: part.status,
                error: part.error,
                messages: toAIMessages(part.messages, model, options),
              },
            },
          ];
        case "text":
          return [{ type: "text", content: part.text, metadata: part.phase ? { phase: part.phase } : undefined }];
        case "reasoning":
          return [
            {
              type: "thinking",
              content: part.summary ?? part.text,
              stepId: part.id,
              signature: packGatewayReasoning({
                id: part.id,
                text: part.text,
                summary: part.summary,
                model: part.model,
                encryptedContent:
                  (!model || part.model === model) &&
                  !message.content.some((item) => item.type === "tool_call" && !answeredCalls.has(item.id))
                    ? part.encryptedContent
                    : undefined,
              }),
            },
          ];
        case "tool_call":
          return [
            {
              type: "tool-call",
              id: part.id,
              name: part.name,
              arguments: part.arguments,
              state: part.incomplete
                ? "input-streaming"
                : answeredCalls.has(part.id)
                  ? "complete"
                  : options?.pendingToolCalls === false
                    ? "input-streaming"
                    : "input-complete",
            },
          ];
        case "tool_result":
          return [
            {
              type: "tool-result",
              toolCallId: part.id,
              name: part.name,
              state: message.error ? "error" : "complete",
              error: message.error?.message,
              // Match live tool execution: rich files stay
              // in presentation metadata; the provider receives descriptions.
              // Native discovery also restores its cache from this JSON text.
              content: serializeToolResultForApi(part.result),
              metadata: { wingman: part, wingmanError: message.error },
            },
          ];
        case "image":
        case "audio":
        case "file":
          return toAIContent([part]);
        case "summary":
        case "runtime_feedback":
          return [{ type: "text", content: part.text, metadata: { wingmanContent: part } }];
        case "artifact_selection":
          return [
            {
              type: "text",
              content: `\n${formatArtifactSelection(part)}`,
              metadata: { wingmanContent: part },
            },
          ];
        case "artifact_ref":
          return [{ type: "text", content: `Workspace file: ${part.path}`, metadata: { wingmanContent: part } }];
      }
    }),
  }));
  const native: UIMessage[] = [];
  const owners = new Map<string, UIMessage>();
  for (const message of converted) {
    // Wingman persisted tool outputs as user turns. TanStack anchors them to
    // the assistant that called the tool, including multimodal results.
    const next = { ...message, parts: [] as MessagePart[] };
    for (const part of message.parts) {
      if (part.type === "tool-result") owners.get(part.toolCallId)?.parts.push(part);
      else {
        next.parts.push(part);
        if (part.type === "tool-call") owners.set(part.id, next);
      }
    }
    // A moved tool result carries its own error. Keeping its empty user turn
    // would duplicate the result's ID on replay and send an invalid request.
    if (next.parts.length || (message.role === "assistant" && message.metadata?.wingman?.error)) native.push(next);
  }
  return native;
}

export function toAIContent(content: Content[]): ContentPart[] {
  return content.flatMap((part): ContentPart[] => {
    if (part.type === "text") return [{ type: "text", content: part.text }];
    if (part.type === "image" || part.type === "audio" || part.type === "file") {
      const match = /^data:([^;,]+)(?:;base64)?,([\s\S]*)$/.exec(part.data);
      const source = match
        ? { type: "data" as const, value: match[2], mimeType: match[1] }
        : { type: "url" as const, value: part.data };
      return [
        {
          type: part.type === "file" ? "document" : part.type,
          source,
          metadata: { filename: part.name, ...(part.contentType ? { contentType: part.contentType } : {}) },
        },
      ];
    }
    return [];
  });
}

function fromAIContent(part: ContentPart): Content[] {
  const original = (part.metadata as { wingmanContent?: Content } | undefined)?.wingmanContent as Content | undefined;
  if (original) return [original];
  if (part.type === "text") {
    const metadata = part.metadata as { phase?: "commentary" | "final_answer" } | undefined;
    return [{ type: "text", text: part.content, ...(metadata?.phase ? { phase: metadata.phase } : {}) }];
  }
  if (part.type === "video" || part.source.type === "file") return [];
  const data =
    part.source.type === "url" ? part.source.value : `data:${part.source.mimeType};base64,${part.source.value}`;
  const contentType = (part.metadata as { contentType?: string } | undefined)?.contentType;
  const stored = contentType ? { contentType } : {};
  if (part.type === "document")
    return [
      {
        type: "file",
        name: (part.metadata as { filename?: string } | undefined)?.filename ?? "attachment",
        data,
        ...stored,
      },
    ];
  const name = (part.metadata as { filename?: string } | undefined)?.filename;
  return [{ type: part.type, data, ...(name ? { name } : {}), ...stored }];
}

export function fromAIMessages(messages: UIMessage[], runId?: string, model?: string, richResults = true): Message[] {
  const calls = new Map(
    messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "tool-call" ? [[p.id, p] as const] : []))),
  );
  return messages
    .filter((m) => m.role !== "system")
    .flatMap((message): Message[] => {
      const stored = message.metadata?.wingman as Partial<Message> | undefined;
      const phases =
        (message.metadata?.wingmanTextSegments as GatewayTextSegment[] | undefined)?.filter((part) => part.content) ??
        [];
      let phaseIndex = 0;
      let phaseOffset = 0;
      const textContent = (part: Extract<ContentPart, { type: "text" }>): Content[] => {
        if ((part.metadata as { wingmanContent?: Content } | undefined)?.wingmanContent) return fromAIContent(part);
        if (!phases.length) return fromAIContent(part);
        const output: Content[] = [];
        let text = part.content;
        while (text) {
          const segment = phases[phaseIndex];
          const remaining = segment?.content.slice(phaseOffset);
          if (!remaining || (!text.startsWith(remaining) && !remaining.startsWith(text))) return fromAIContent(part);
          const length = Math.min(text.length, remaining.length);
          output.push({
            type: "text",
            text: text.slice(0, length),
            ...(segment.phase ? { phase: segment.phase } : {}),
          });
          text = text.slice(length);
          phaseOffset += length;
          if (phaseOffset === segment.content.length) {
            phaseIndex++;
            phaseOffset = 0;
          }
        }
        return output;
      };
      const converted: Message = {
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        runId: stored?.runId ?? runId,
        createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : undefined,
        usage: stored?.usage,
        error: stored?.error,
        content: message.parts.flatMap((part): Content[] => {
          switch (part.type) {
            case "subagent":
              return [
                {
                  type: "subagent",
                  id: part.subagent.id,
                  name: part.subagent.name,
                  description: part.subagent.description,
                  runId: part.subagent.parentRunId,
                  toolCallId: part.subagent.parentToolCallId,
                  status: part.subagent.status,
                  error: part.subagent.error,
                  messages: fromAIMessages(part.subagent.messages, runId, model, richResults),
                  signature: subagentSignature(part.subagent),
                },
              ];
            case "text":
              return textContent(part);
            case "image":
            case "audio":
            case "document":
            case "video":
              return fromAIContent(part);
            case "thinking": {
              const state = readGatewayReasoning(part.signature);
              return [
                {
                  type: "reasoning",
                  id: part.stepId ?? message.id,
                  text: part.content,
                  ...state,
                  model:
                    state.model ??
                    (message.metadata?.wingmanReasoningModels as Record<string, string> | undefined)?.[
                      part.stepId ?? message.id
                    ] ??
                    stored?.usage?.model ??
                    model,
                },
              ];
            }
            case "tool-call":
              return [
                {
                  type: "tool_call",
                  id: part.id,
                  name: part.name,
                  arguments: part.arguments,
                  incomplete: part.state === "input-streaming",
                },
              ];
            case "tool-result": {
              const original = richResults ? (part.metadata?.wingman as ToolResultContent | undefined) : undefined;
              if (original) return [original];
              const call = calls.get(part.toolCallId);
              return [
                {
                  type: "tool_result",
                  id: part.toolCallId,
                  name: part.name ?? call?.name ?? "tool",
                  arguments: call?.arguments ?? "{}",
                  result:
                    typeof part.content === "string"
                      ? [{ type: "text", text: part.content }]
                      : part.content
                          .flatMap(fromAIContent)
                          .filter(
                            (p) => p.type === "text" || p.type === "image" || p.type === "audio" || p.type === "file",
                          ),
                },
              ];
            }
            case "structured-output":
              return [{ type: "text", text: part.raw ?? JSON.stringify(part.data) }];
            default:
              return [];
          }
        }),
      };
      // Native messages can contain multiple model/tool rounds. Keep their part
      // order when projecting into the application's persisted turn format.
      const turns: Message[] = [];
      let body: Content[] = [];
      const flush = () => {
        if (body.length)
          turns.push({ ...converted, id: turns.length ? `${message.id}-${turns.length}` : message.id, content: body });
        body = [];
      };
      for (const part of converted.content) {
        if (part.type === "tool_result") {
          flush();
          const failed = message.parts.find(
            (item): item is Extract<MessagePart, { type: "tool-result" }> =>
              item.type === "tool-result" && item.toolCallId === part.id && item.state === "error",
          );
          turns.push({
            id: `result-${part.id}`,
            runId: converted.runId,
            role: "user",
            content: [part],
            ...(failed
              ? {
                  error: (failed.metadata?.wingmanError as Message["error"] | undefined) ?? {
                    code: "TOOL_EXECUTION_ERROR",
                    message:
                      failed.error ??
                      "The tool could not complete the requested action. Please try again or use a different approach.",
                  },
                }
              : {}),
          });
        } else body.push(part);
      }
      flush();
      return turns.length ? turns : converted.role === "assistant" && converted.error ? [converted] : [];
    });
}
