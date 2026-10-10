import { OpenAITextAdapter, type OpenAIChatModel } from "@tanstack/ai-openai";
import type { AdapterYieldChunk, TextPart } from "@tanstack/ai";
import { isReasoningReplayError } from "./errors";
import { packGatewayReasoning, readGatewayReasoning, type GatewayReasoning } from "./reasoning";
import { text, textMetadata, type TextPhase } from "./messages";

/** Gateway compatibility around TanStack's native Responses parsing and tool loop. */
export class GatewayTextAdapter<TModel extends OpenAIChatModel> extends OpenAITextAdapter<TModel> {
  responseInfo?: { model: string; reasoningContext?: "current_turn" | "all_turns" };
  readonly rejectedReasoning = new Set<string>();
  readonly textParts = new Map<string, TextPart[]>();
  needsMessageSnapshot = false;

  // A gateway response may contain commentary as well as schema JSON. Use
  // TanStack's event source so only the final message becomes the schema result.
  combinedStructuredOutputSource(): "event" {
    return "event";
  }

  override async *chatStream(
    ...args: Parameters<OpenAITextAdapter<TModel>["chatStream"]>
  ): AsyncIterable<AdapterYieldChunk> {
    const [options] = args;
    let started = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      let receivedContent = false;
      let retry = false;
      for await (const chunk of super.chatStream(...args)) {
        if (chunk.type === "RUN_STARTED") {
          if (!started) yield chunk;
          started = true;
          continue;
        }
        if (
          chunk.type === "RUN_ERROR" &&
          attempt === 0 &&
          !receivedContent &&
          !options.request?.signal?.aborted &&
          !options.abortController?.signal.aborted &&
          isReasoningReplayError(chunk)
        ) {
          const payloads = options.messages.flatMap((message) =>
            (message.thinking ?? []).flatMap((part) => {
              const { encryptedContent } = readGatewayReasoning(part.signature);
              return encryptedContent && !this.rejectedReasoning.has(encryptedContent) ? [encryptedContent] : [];
            }),
          );
          if (payloads.length) {
            for (const payload of payloads) this.rejectedReasoning.add(payload);
            this.needsMessageSnapshot = true;
            retry = true;
            break;
          }
        }
        receivedContent = true;
        yield chunk;
      }
      if (!retry) return;
    }
  }

  protected override async *processStreamChunks(
    ...args: Parameters<OpenAITextAdapter<TModel>["processStreamChunks"]>
  ): AsyncIterable<AdapterYieldChunk> {
    this.responseInfo = undefined;
    const [stream, ...rest] = args;
    const options = rest[1];
    const segments = new Map<string, TextPart>();
    const reasoning = new Map<string, GatewayReasoning>();
    let activeReasoningId: string | undefined;
    let completed = false;
    let emittedText = "";
    const capture = (item: {
      id: string;
      type: string;
      phase?: TextPhase;
      content?: { type: string; text?: string }[];
      summary?: { type: string; text?: string }[];
      encrypted_content?: string;
    }) => {
      if (item.type === "message")
        segments.set(
          item.id,
          text(
            item.content?.flatMap((part) => (part.type === "output_text" ? [part.text ?? ""] : [])).join("") ?? "",
            item.phase ? { phase: item.phase } : undefined,
          ),
        );
      if (item.type === "reasoning") {
        activeReasoningId = item.id;
        const previous = reasoning.get(item.id) ?? reasoning.get("");
        reasoning.delete("");
        reasoning.set(item.id, {
          ...previous,
          id: item.id,
          encryptedContent: item.encrypted_content ?? previous?.encryptedContent,
          text:
            item.content?.flatMap((part) => (part.type === "reasoning_text" ? [part.text ?? ""] : [])).join("") ??
            previous?.text ??
            "",
          summary: item.summary ? item.summary.map((part) => part.text ?? "").join("") || undefined : previous?.summary,
          // Replay is bound to the requested deployment alias. Usage separately
          // records the resolved provider model, which may have a different id.
          model: options.model,
        });
      }
    };
    const captureResponse = (response: { model: string; reasoning?: unknown }) => {
      const context = (response.reasoning as { context?: unknown } | undefined)?.context;
      this.responseInfo = {
        model: response.model,
        reasoningContext: context === "current_turn" || context === "all_turns" ? context : undefined,
      };
    };
    async function* observe() {
      for await (const event of stream) {
        if (event.type === "response.output_item.added" || event.type === "response.output_item.done")
          capture(event.item as Parameters<typeof capture>[0]);
        else if (event.type === "response.output_text.delta") {
          const segment = segments.get(event.item_id) ?? text("");
          segments.set(event.item_id, { ...segment, content: segment.content + event.delta });
        } else if (
          event.type === "response.reasoning_text.delta" ||
          event.type === "response.reasoning.delta" ||
          event.type === "response.reasoning_summary_text.delta"
        ) {
          const id = ("item_id" in event ? event.item_id : activeReasoningId) ?? "";
          const field = event.type === "response.reasoning_summary_text.delta" ? "summary" : "text";
          const previous = reasoning.get(id) ?? {};
          const delta = typeof event.delta === "string" ? event.delta : "";
          reasoning.set(id, { ...previous, [field]: (previous[field] ?? "") + delta });
        } else if (event.type === "response.completed") {
          completed = true;
          captureResponse(event.response);
          segments.clear();
          for (const item of event.response.output) capture(item as Parameters<typeof capture>[0]);
        }
        yield event;
      }
    }
    for await (const chunk of super.processStreamChunks(observe(), ...rest)) {
      if (chunk.type.startsWith("TEXT_MESSAGE_") && "messageId" in chunk && chunk.messageId)
        this.textParts.set(chunk.messageId, [...segments.values()]);
      if (chunk.type === "REASONING_ENCRYPTED_VALUE" && chunk.subtype === "message") {
        const state = readGatewayReasoning(chunk.encryptedValue);
        yield {
          ...chunk,
          encryptedValue: packGatewayReasoning({ ...state, ...reasoning.get(state.id ?? ""), model: options.model }),
        };
        continue;
      }
      if (chunk.type === "TEXT_MESSAGE_CONTENT")
        emittedText = typeof chunk.content === "string" ? chunk.content : emittedText + chunk.delta;
      if (chunk.type === "TEXT_MESSAGE_END" && completed) {
        const fullText = [...segments.values()].map((part) => part.content).join("");
        if (fullText && fullText !== emittedText) {
          const append = fullText.startsWith(emittedText);
          if (!append) this.needsMessageSnapshot = true;
          yield {
            type: "TEXT_MESSAGE_CONTENT",
            messageId: chunk.messageId,
            delta: append ? fullText.slice(emittedText.length) : "",
            content: fullText,
          } as AdapterYieldChunk;
          emittedText = fullText;
        }
      }
      if (chunk.type === "RUN_FINISHED" && completed && options.outputSchema && chunk.finishReason === "stop") {
        const parts = [...segments.values()];
        const raw = (parts.findLast((part) => textMetadata(part).phase === "final_answer") ?? parts.at(-1))?.content;
        if (raw) {
          try {
            yield { type: "CUSTOM", name: "structured-output.complete", value: { object: JSON.parse(raw), raw } };
          } catch {
            yield {
              type: "RUN_ERROR",
              code: "structured-output-parse-failed",
              message: "Failed to parse final structured output as JSON",
            } as AdapterYieldChunk;
            return;
          }
        }
      }
      yield chunk;
    }
  }

  /**
   * The gateway translates tools for every provider, so they keep their own
   * JSON Schema. OpenAI strict mode would widen optional fields to
   * `["string", "null"]`, which Anthropic rejects next to an `enum`.
   */
  /** The deployment alias the current request targets; ciphertext replays only to its producer. */
  private requestModel?: string;

  protected override mapOptionsToRequest(...args: Parameters<OpenAITextAdapter<TModel>["mapOptionsToRequest"]>) {
    this.requestModel = args[0].model;
    const request = super.mapOptionsToRequest(...args);
    const schemas = new Map(args[0].tools?.map((tool) => [tool.name, tool.inputSchema]));
    return {
      ...request,
      tools: request.tools?.map((tool) =>
        tool.type === "function"
          ? {
              ...tool,
              parameters: schemas.get(tool.name) ?? { type: "object", properties: {}, required: [] },
              strict: false,
            }
          : tool,
      ),
    };
  }

  /** The gateway accepts inline files beyond the native adapter's PDF-only contract. */
  protected override convertContentPartToInput(
    ...args: Parameters<OpenAITextAdapter<TModel>["convertContentPartToInput"]>
  ): ReturnType<OpenAITextAdapter<TModel>["convertContentPartToInput"]> {
    const [part] = args;
    if (part.type !== "document" || part.source.type !== "data") return super.convertContentPartToInput(...args);
    const metadata = part.metadata as { filename?: string; contentType?: string } | undefined;
    return {
      type: "input_file",
      filename: metadata?.filename ?? "attachment",
      file_data: part.source.value.startsWith("data:")
        ? part.source.value
        : `data:${part.source.mimeType ?? metadata?.contentType ?? "application/octet-stream"};base64,${part.source.value}`,
    };
  }

  protected override convertMessagesToInput(
    ...args: Parameters<OpenAITextAdapter<TModel>["convertMessagesToInput"]>
  ): ReturnType<OpenAITextAdapter<TModel>["convertMessagesToInput"]> {
    const phased = new Map<string, TextPart[][]>();
    const reasoning = new Map<string, GatewayReasoning>();
    const messages = args[0].map((message) => {
      const parts =
        message.role === "assistant"
          ? Array.isArray(message.content) && message.content.every((part) => part.type === "text")
            ? message.content
            : this.textParts.get(message.id ?? "")
          : undefined;
      const content = parts?.map((part) => part.content).join("");
      if (message.role === "assistant" && content && parts?.some((part) => textMetadata(part).phase))
        phased.set(content, [...(phased.get(content) ?? []), parts]);
      let rejected = false;
      // An interrupted response can leave a signed reasoning item without
      // text or a tool call. Keep it visible in history, but do not replay an
      // assistant turn ending in thinking to gateway providers such as Claude.
      const hasOutput =
        !!message.toolCalls?.length ||
        (typeof message.content === "string"
          ? !!message.content
          : !!message.content?.some((part) => part.type === "text" && part.content));
      const thinking = message.thinking?.map((part) => {
        const state = readGatewayReasoning(part.signature);
        if (
          !hasOutput ||
          !state.encryptedContent ||
          this.rejectedReasoning.has(state.encryptedContent) ||
          (state.model !== undefined && this.requestModel !== undefined && state.model !== this.requestModel)
        ) {
          rejected ||= !!state.encryptedContent;
          return { ...part, signature: undefined };
        }
        if (state.id && !reasoning.has(state.id)) reasoning.set(state.id, state);
        return part;
      });
      return {
        ...message,
        ...(Array.isArray(message.content) && parts === message.content ? { content } : {}),
        thinking,
        // Persisted item ids depend on their original reasoning item. call_id
        // still correlates results when the rejected reasoning is removed.
        ...(rejected
          ? {
              toolCalls: message.toolCalls?.map((call) => ({
                ...call,
                metadata: { ...(call.metadata as Record<string, unknown> | undefined), itemId: undefined },
              })),
            }
          : {}),
      };
    });
    return super
      .convertMessagesToInput(messages)
      .flatMap((item): ReturnType<OpenAITextAdapter<TModel>["convertMessagesToInput"]> => {
        if (item.type === "reasoning") {
          const state = reasoning.get(item.id);
          // Unextended native signatures already store their summary in content.
          if (state?.text !== undefined)
            return [
              {
                ...item,
                summary: state.summary ? [{ type: "summary_text" as const, text: state.summary }] : [],
                ...(state.text ? { content: [{ type: "reasoning_text" as const, text: state.text }] } : {}),
              },
            ];
          return [item];
        }
        if (item.type !== "message" || item.role !== "assistant" || typeof item.content !== "string") return [item];
        const parts = phased.get(item.content)?.shift();
        return parts
          ? parts.map((part) => ({
              ...item,
              content: part.content,
              ...(textMetadata(part).phase ? { phase: textMetadata(part).phase } : {}),
            }))
          : [item];
      });
  }
}
