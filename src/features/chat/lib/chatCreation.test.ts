import { describe, expect, it, vi } from "vitest";
import type { Chat, Message } from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import { createChatCreationGate } from "./chatCreation";

describe("createChatCreationGate", () => {
  it("puts simultaneous messages in one newly-created chat", async () => {
    let finishSaving: (() => void) | undefined;
    const saving = new Promise<void>((resolve) => {
      finishSaving = resolve;
    });
    const chat: Chat = {
      id: "chat-1",
      created: new Date("2026-01-01T00:00:00.000Z"),
      updated: new Date("2026-01-01T00:00:00.000Z"),
      model: null,
      messages: [],
    };
    const createChat = vi.fn(async () => {
      await saving;
      return chat;
    });
    const createOnce = createChatCreationGate();
    const messages: Message[] = [
      { role: Role.User, content: [{ type: "text", text: "Hello" }] },
      { role: Role.Assistant, content: [{ type: "text", text: "Hi" }] },
    ];

    const append = async (message: Message) => {
      const target = await createOnce(createChat);
      target.messages.push(message);
      return target;
    };
    const appends = messages.map(append);

    expect(createChat).toHaveBeenCalledTimes(1);
    finishSaving?.();

    const targets = await Promise.all(appends);
    expect(targets).toEqual([chat, chat]);
    expect(chat.messages).toEqual(messages);
  });
});
