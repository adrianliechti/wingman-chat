import type { Response, ResponseInputItem, ResponseInputContent } from "openai/resources/responses/responses";
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from "openai/error";
import { Role, type Content, type Message, type ReasoningContent } from "../types/chat";
import { selectFinalAssistantMessage } from "./assistantText";
import { dropOrphanFunctionCalls } from "./recovery";
import { serializeToolResultForApi } from "./utils";

/** Build a portable, self-contained request without changing persisted history. */
export function toResponseInput(input: Message[]): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];

  for (const m of input) {
    switch (m.role) {
      case Role.User: {
        const content: ResponseInputContent[] = [];

        // Process all content parts
        for (const part of m.content) {
          if (part.type === "text") {
            content.push({ type: "input_text", text: part.text });
          } else if (part.type === "runtime_feedback") {
            content.push({ type: "input_text", text: part.text });
          } else if (part.type === "artifact_ref") {
            content.push({
              type: "input_text",
              text: `[Artifact: ${part.displayName ?? part.path}; path=${part.path}${part.revision ? `; revision=${part.revision}` : ""}]`,
            });
          } else if (part.type === "image") {
            const imgPart = part;
            // Skip attachments with unrecognized MIME (e.g. application/octet-stream)
            if (imgPart.data.startsWith("data:application/octet-stream")) continue;
            content.push({
              type: "input_image",
              image_url: imgPart.data,
              detail: "auto",
            });
          } else if (part.type === "file") {
            const filePart = part;
            if (filePart.data.startsWith("data:application/octet-stream")) continue;
            content.push({
              type: "input_file",
              file_data: filePart.data,
              filename: filePart.name,
            });
          } else if (part.type === "tool_result") {
            // Tool results in user messages go as function_call_output
            // Binary data (images, audio, files) is stripped and replaced with descriptions
            // since the model cannot process base64 data in text output
            const tr = part;
            const output = serializeToolResultForApi(tr.result);
            items.push({
              type: "function_call_output",
              call_id: tr.id,
              output: output,
            });
          }
          // Skip reasoning, tool_call in user messages
        }

        // Only add user message if there's content (not just tool results)
        if (content.length > 0) {
          items.push({
            type: "message",
            role: "user",
            content: content,
          });
        }

        break;
      }

      case Role.Assistant: {
        // Reasoning items are intentionally not replayed back to the API.
        // encrypted_content is provider+key-specific and breaks on model
        // swaps and across Azure deployments/subscriptions.

        let bufferedText = "";

        const flushAssistantText = () => {
          if (!bufferedText) {
            return;
          }

          items.push({
            type: "message",
            role: "assistant",
            content: bufferedText,
          });

          bufferedText = "";
        };

        for (const part of m.content) {
          if (part.type === "text") {
            if (part.phase) {
              flushAssistantText();
              items.push({ type: "message", role: "assistant", content: part.text, phase: part.phase });
              continue;
            }
            bufferedText += part.text;
            continue;
          }

          if (part.type === "artifact_ref") {
            bufferedText += `\n[Artifact: ${part.displayName ?? part.path}; path=${part.path}${part.revision ? `; revision=${part.revision}` : ""}]`;
            continue;
          }

          if (part.type === "tool_call") {
            flushAssistantText();
            items.push({
              type: "function_call",
              call_id: part.id,
              name: part.name,
              arguments: part.arguments,
            });
          }

          if (part.type === "summary") {
            // Replay client-side summary as assistant text. The wrapper
            // tells the model the prior context was condensed and to
            // continue naturally without referencing the summary itself.
            flushAssistantText();
            items.push({
              type: "message",
              role: "assistant",
              content: `[Earlier conversation condensed to save context. Continue naturally without referencing this summary.]\n\n${part.text}`,
            });
          }
        }

        flushAssistantText();

        break;
      }
    }
  }

  return dropOrphanFunctionCalls(items);
}

/** A clean HTTP EOF does not guarantee that generation actually finished. */
export function validateResponse(response: Response, allowTruncatedTools = false): void {
  if (response.error) {
    throw new APIError(undefined, response.error, response.error.message, undefined);
  }
  if (response.status === "cancelled") throw new APIUserAbortError();
  if (response.status === "incomplete") {
    if (response.incomplete_details?.reason === "content_filter") throw new ContentFilterFinishReasonError();
    if (response.incomplete_details?.reason === "max_output_tokens") {
      if (allowTruncatedTools && response.output.some((item) => item.type === "function_call")) return;
      throw new LengthFinishReasonError();
    }
    throw new APIError(
      undefined,
      { code: "response_incomplete", message: "The model returned an incomplete response." },
      undefined,
      undefined,
    );
  }
  if (response.status === "failed") {
    throw new APIError(
      undefined,
      { code: "response_failed", message: "The model response failed." },
      undefined,
      undefined,
    );
  }
  if (response.status !== "completed") {
    throw new APIConnectionError({ message: "The stream ended before the model finished responding." });
  }
}

/** Extract only the final message before JSON parsing; SDK output_text joins messages and output_parsed picks the first. */
export function finalResponseText(response: Response): string | null {
  validateResponse(response);
  const message = selectFinalAssistantMessage(response.output.filter((item) => item.type === "message"));
  if (!message) return null;
  if (message.status && message.status !== "completed") {
    throw new APIError(
      undefined,
      { code: "response_incomplete", message: "The model's final answer was incomplete." },
      undefined,
      undefined,
    );
  }
  if (message.content.some((part) => part.type === "refusal")) return null;
  return message.content.map((part) => (part.type === "output_text" ? part.text : "")).join("") || null;
}

/** Use the final output as the source of truth, keeping one text part per assistant message. */
export function responseContent(response: Response): Content[] {
  const parts: Content[] = [];
  let reasoning: ReasoningContent | undefined;
  for (const item of response.output) {
    if (item.type === "message") {
      const text = item.content
        .map((part) => (part.type === "output_text" ? part.text : part.type === "refusal" ? part.refusal : ""))
        .join("");
      parts.push({ type: "text", text, ...(item.phase ? { phase: item.phase } : {}) });
    } else if (item.type === "function_call") {
      parts.push({
        type: "tool_call",
        id: item.call_id,
        name: item.name,
        arguments: item.arguments,
        // If the provider omits item status on a truncated response, the call
        // must still be rejected by dispatch rather than repaired and executed.
        ...(item.status === "incomplete" ||
        item.status === "in_progress" ||
        (response.status === "incomplete" && item.status !== "completed")
          ? { incomplete: true }
          : {}),
      });
    } else if (item.type === "reasoning") {
      if (!reasoning) {
        reasoning = { type: "reasoning", id: item.id, text: "" };
        parts.unshift(reasoning);
      }
      reasoning.text += item.content?.map((part) => part.text).join("") ?? "";
      const summary = item.summary?.map((part) => part.text).join("\n") ?? "";
      if (summary) reasoning.summary = [reasoning.summary, summary].filter(Boolean).join("\n");
    }
  }
  return parts;
}
