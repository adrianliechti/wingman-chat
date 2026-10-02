import { expect, it, vi } from "vitest";
import { inlineSkill, withSkills } from "@tanstack/ai-skills";
import { run } from "@/shared/lib/agent";
import { testClient } from "@/shared/lib/test-support/ai";
import { chatCompaction, preserveSkillContext } from "./chatCompaction";
import type { MetadataStore } from "@tanstack/ai";
import { withMessageIdentity, type Message } from "@/shared/types/chat";
import { prepareChatMessages } from "./chatHistory";
import instructions from "../prompts/summarize-history.txt?raw";

it("compacts after large tool outputs, preserving active skill instructions and the complete transcript", async () => {
  const complete = vi
    .fn<Parameters<typeof testClient>[0]>()
    .mockResolvedValueOnce({
      role: "assistant",
      content: [{ type: "tool_call", id: "skill", name: "load_skill", arguments: '{"name":"reports"}' }],
    })
    .mockResolvedValueOnce({
      role: "assistant",
      content: Array.from({ length: 4 }, (_, i) => ({
        type: "tool_call",
        id: `read-${i}`,
        name: "read",
        arguments: JSON.stringify({ large: i === 0 }),
      })),
    })
    .mockImplementationOnce(async ({ messages }) => {
      const request = JSON.stringify(messages);
      expect(request).toContain("Verify every report against its sources.");
      expect(request).toContain("Build a report");
      expect(request).not.toContain("Large evidence ".repeat(1000));
      expect(request).toContain("tool output cleared to save context");
      return { role: "assistant", content: [{ type: "text", text: "Verified" }] };
    });
  const client = testClient(complete);
  const result = await run(
    client,
    "model",
    "",
    [{ role: "user", content: [{ type: "text", text: "Build a report" }] }],
    [
      {
        name: "read",
        parameters: { type: "object", properties: { large: { type: "boolean" } } },
        function: async (args) => [
          { type: "text", text: args.large ? "Large evidence ".repeat(1000) : "Small evidence" },
        ],
      },
    ],
    {
      sharedMiddleware: (signal) => [chatCompaction(client, 1000, "model", signal), preserveSkillContext()],
      prepareMessages: (messages) => prepareChatMessages(messages, "Current workspace: /"),
      middleware: [
        withSkills(
          inlineSkill({
            name: "reports",
            description: "Build reports",
            instructions: "Verify every report against its sources.",
          }),
        ),
      ],
    },
  );
  expect(result.status).toBe("completed");
  expect(complete).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(result.messages)).toContain("Large evidence ".repeat(1000));
  expect(JSON.stringify(result.messages)).not.toContain("tool output cleared to save context");
});

it("reuses native checkpoints across tool turns and stored transcripts, invalidating edits and strategy changes", async () => {
  const entries = new Map<string, unknown>();
  const metadata: MetadataStore = {
    get: async (namespace, key) => entries.get(`${namespace}:${key}`) ?? null,
    set: async (namespace, key, value) => {
      entries.set(`${namespace}:${key}`, JSON.parse(JSON.stringify(value)));
    },
    delete: async (namespace, key) => {
      entries.delete(`${namespace}:${key}`);
    },
  };
  let summaries = 0;
  let turns = 0;
  const complete = vi.fn<Parameters<typeof testClient>[0]>().mockImplementation(async (options) => {
    if (options.systemPrompts?.includes(instructions)) {
      summaries++;
      expect(JSON.stringify(options.messages)).not.toContain("Current workspace");
      expect(options.messages.at(-1)).toMatchObject({ role: "user", content: "Summarize the preceding conversation." });
      return { role: "assistant", content: [{ type: "text", text: "Earlier evidence was verified." }] };
    }
    turns++;
    const request = JSON.stringify(options.messages);
    expect(request).toContain("untrusted-conversation-summary");
    expect(request).toContain("Current workspace");
    expect(request).not.toContain("Large evidence ".repeat(1000));
    return {
      role: "assistant",
      content:
        turns < 3
          ? [{ type: "tool_call", id: `read-${turns}`, name: "read", arguments: "{}" }]
          : [{ type: "text", text: "Done" }],
    };
  });
  const client = testClient(complete);
  const execute = (messages: Message[], model = "model") =>
    run(
      client,
      "model",
      "",
      messages,
      [{ name: "read", parameters: { type: "object" }, function: async () => [{ type: "text", text: "Read" }] }],
      {
        threadId: "chat",
        sharedMiddleware: (signal) => [chatCompaction(client, 1000, model, signal, metadata)],
        prepareMessages: (messages) => prepareChatMessages(messages, "Current workspace: /"),
      },
    );
  const original: Message[] = [
    { role: "user", content: [{ type: "text", text: "Previous request" }] },
    { role: "assistant", content: [{ type: "text", text: "Large evidence ".repeat(1000) }] },
    { role: "user", content: [{ type: "text", text: "Current request" }] },
  ].map((message) => withMessageIdentity(message as Message));
  const first = await execute(original);
  expect(first.status).toBe("completed");
  expect(turns).toBe(3);
  expect(summaries).toBe(1);
  expect(entries.size).toBe(1);
  expect(JSON.stringify(first.messages)).toContain("Large evidence ".repeat(1000));
  expect(JSON.stringify(first.messages)).not.toContain("untrusted-conversation-summary");
  const restored: Message[] = JSON.parse(JSON.stringify(first.messages));
  restored.push(withMessageIdentity({ role: "user", content: [{ type: "text", text: "Follow up" }] }));
  expect((await execute(restored)).status).toBe("completed");
  expect(summaries).toBe(1);
  restored[0].content = [{ type: "text", text: "Edited earlier request" }];
  await execute(restored);
  expect(summaries).toBe(2);
  await execute(restored, "different-summarizer");
  expect(summaries).toBe(3);
});
