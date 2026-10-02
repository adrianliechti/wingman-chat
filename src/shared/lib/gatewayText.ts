import { OpenAITextAdapter, type OpenAIChatModel } from "@tanstack/ai-openai";

export interface GatewayTextSegment {
  content: string;
  phase?: "commentary" | "final_answer";
}

/** Preserve gateway phases and context metadata not exposed by the native adapter. */
export class GatewayTextAdapter<TModel extends OpenAIChatModel> extends OpenAITextAdapter<TModel> {
  responseInfo?: { model: string; reasoningContext?: "current_turn" | "all_turns" };

  protected override async *processStreamChunks(...args: Parameters<OpenAITextAdapter<TModel>["processStreamChunks"]>) {
    this.responseInfo = undefined;
    const [stream, ...rest] = args;
    const segments = new Map<string, GatewayTextSegment>();
    const capture = (item: {
      id: string;
      type: string;
      phase?: GatewayTextSegment["phase"];
      content?: { type: string; text?: string }[];
    }) => {
      if (item.type === "message")
        segments.set(item.id, {
          content:
            item.content?.flatMap((part) => (part.type === "output_text" ? [part.text ?? ""] : [])).join("") ?? "",
          phase: item.phase,
        });
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
          const segment = segments.get(event.item_id) ?? { content: "" };
          segments.set(event.item_id, { ...segment, content: segment.content + event.delta });
        } else if (event.type === "response.completed") {
          captureResponse(event.response);
          for (const item of event.response.output) capture(item as Parameters<typeof capture>[0]);
        }
        yield event;
      }
    }
    for await (const chunk of super.processStreamChunks(observe(), ...rest)) {
      if (chunk.type.startsWith("TEXT_MESSAGE_")) {
        yield {
          ...chunk,
          metadata: {
            ...("metadata" in chunk ? chunk.metadata : {}),
            wingmanTextSegments: [...segments.values()].map((segment) => ({ ...segment })),
          },
        };
      } else yield chunk;
    }
  }

  /**
   * The gateway translates tools for every provider, so they keep their own
   * JSON Schema. OpenAI strict mode would widen optional fields to
   * `["string", "null"]`, which Anthropic rejects next to an `enum`.
   */
  protected override mapOptionsToRequest(...args: Parameters<OpenAITextAdapter<TModel>["mapOptionsToRequest"]>) {
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

  protected override convertMessagesToInput(...args: Parameters<OpenAITextAdapter<TModel>["convertMessagesToInput"]>) {
    const phased = new Map<string, GatewayTextSegment[][]>();
    for (const message of args[0]) {
      if (message.role !== "assistant") continue;
      const parts = message.metadata?.wingmanTextSegments as GatewayTextSegment[] | undefined;
      if (!parts) continue;
      const text = parts.map((part) => part.content).join("");
      if (text) phased.set(text, [...(phased.get(text) ?? []), parts]);
    }
    return super.convertMessagesToInput(...args).flatMap((item) => {
      if (item.type !== "message" || item.role !== "assistant" || typeof item.content !== "string") return [item];
      const parts = phased.get(item.content)?.shift();
      return parts?.some((part) => part.phase)
        ? parts.map((part) => ({ ...item, content: part.content, ...(part.phase ? { phase: part.phase } : {}) }))
        : [item];
    });
  }
}
