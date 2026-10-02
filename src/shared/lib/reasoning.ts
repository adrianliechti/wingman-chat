import type { Content, Message, ReasoningContent } from "../types/chat";

export type GatewayReasoning = Partial<
  Pick<ReasoningContent, "id" | "encryptedContent" | "text" | "summary" | "model">
>;

/** Keep gateway fields in TanStack's opaque signature, which survives native model/UI conversion. */
export function packGatewayReasoning(state: GatewayReasoning): string {
  return JSON.stringify({
    id: state.id,
    encrypted_content: state.encryptedContent,
    wingman: { text: state.text, summary: state.summary, model: state.model },
  });
}

/** Also accepts signatures written by the unextended native Responses adapter. */
export function readGatewayReasoning(signature?: string): GatewayReasoning {
  if (!signature) return {};
  try {
    const value = JSON.parse(signature);
    if (!value || typeof value !== "object") return {};
    const fields = value.wingman;
    return {
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      ...(typeof value.encrypted_content === "string" ? { encryptedContent: value.encrypted_content } : {}),
      ...(typeof fields?.text === "string" ? { text: fields.text } : {}),
      ...(typeof fields?.summary === "string" ? { summary: fields.summary } : {}),
      ...(typeof fields?.model === "string" ? { model: fields.model } : {}),
    };
  } catch {
    return {};
  }
}

/** Reasoning can be replayed only when its provider payload and identity are retained. */
export function isReplayableReasoning(part: Content): part is ReasoningContent {
  return part.type === "reasoning" && !!part.encryptedContent && !!part.id;
}

/** Drop the payloads while keeping visible reasoning text. Returns the same array when nothing changed. */
export function clearReplayableReasoning(messages: Message[]): Message[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!message.content.some(isReplayableReasoning)) return message;
    changed = true;
    return {
      ...message,
      content: message.content.map((part): Content => {
        if (!isReplayableReasoning(part)) return part;
        const visible: ReasoningContent = { type: "reasoning", id: part.id, text: part.text };
        if (part.summary) visible.summary = part.summary;
        return visible;
      }),
    };
  });
  return changed ? next : messages;
}
