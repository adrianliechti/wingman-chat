import { describe, expect, it } from "vitest";
import { mergeQueuedMessages, type QueuedSend } from "./chatQueue";
import type { Message } from "@/shared/types/chat";

function queued(id: string, message: Message): QueuedSend {
  return { id, chatId: "chat", message, status: "queued", createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("mergeQueuedMessages", () => {
  it("creates one leading text block and deduplicates artifact references", () => {
    const merged = mergeQueuedMessages([
      queued("1", {
        role: "user",
        content: [
          { type: "text", text: "First" },
          { type: "artifact_ref", path: "/report.md", revision: "sha256:a" },
        ],
      }),
      queued("2", {
        role: "user",
        content: [
          { type: "text", text: "Second" },
          { type: "artifact_ref", path: "/report.md", revision: "sha256:a" },
          { type: "image", name: "reference.png", data: "data:image/png;base64,AA==" },
        ],
      }),
    ]);

    expect(merged.content[0]).toEqual({ type: "text", text: "First\n\nSecond" });
    expect(merged.content.filter((part) => part.type === "artifact_ref")).toHaveLength(1);
    expect(merged.content.some((part) => part.type === "image")).toBe(true);
  });
});
