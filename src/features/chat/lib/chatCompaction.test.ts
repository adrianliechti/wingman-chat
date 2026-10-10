import { z } from "zod";
import type { MetadataStore, UIMessage } from "@tanstack/ai";
import { inlineSkill, withSkills } from "@tanstack/ai-skills";
import { expect, it, vi } from "vitest";
import { run } from "@/shared/lib/agent";
import { assistant, calls, output, testClient, toolCall, user } from "@/shared/lib/test-support/ai";
import { assistantMessage, mediaFromDataUrl, toolRoundMessage, userMessage } from "@/shared/lib/messages";
import { chatCompaction, preserveSkillContext } from "./chatCompaction";
import { prepareChatMessages } from "./chatHistory";
import instructions from "../prompts/summarize-history.txt?raw";

it("budgets tool media by its model description without compacting its bytes", async () => {
  const image = mediaFromDataUrl(`data:image/png;base64,${"YWJj".repeat(10000)}`, "report.png");
  const complete = vi.fn<Parameters<typeof testClient>[0]>().mockImplementation(async ({ messages }) => {
    expect(JSON.stringify(messages)).toContain("[Image: report.png - displayed to user]");
    expect(JSON.stringify(messages)).not.toContain("YWJj");
    return assistant("Done");
  });
  const client = testClient(complete);
  const messages = [
    user("Draw a report"),
    toolRoundMessage({ id: "render", name: "render", arguments: "{}" }, [image]),
  ];
  const result = await run(client, "model", "", messages, [], {
    sharedMiddleware: (signal) => [chatCompaction(client, 1000, "model", signal)],
  });
  expect(result.status).toBe("completed");
  expect(complete).toHaveBeenCalledOnce();
  expect(result.messages[1]).toEqual(messages[1]);
});

it("keeps loaded app skill output without adding a duplicate instruction message", async () => {
  const complete = vi
    .fn<Parameters<typeof testClient>[0]>()
    .mockResolvedValueOnce(calls(["skill", "read_skill", { name: "reports" }]))
    .mockImplementationOnce(async ({ messages }) => {
      expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(messages.find((message) => message.role === "tool")?.content).toContain("Verify reports");
      return assistant("Done");
    });
  const result = await run(
    testClient(complete),
    "model",
    "",
    [user("Build a report")],
    [
      {
        name: "read_skill",
        description: "Test tool",
        inputSchema: z.looseObject({ name: z.string() }),
        execute: async () => output(JSON.stringify({ name: "reports", instructions: "Verify reports" })),
      },
    ],
    {
      sharedMiddleware: () => [preserveSkillContext()],
    },
  );
  expect(result.status).toBe("completed");
  expect(complete).toHaveBeenCalledTimes(2);
});

it("compacts after large tool outputs, preserving active skill instructions and the complete transcript", async () => {
  const complete = vi
    .fn<Parameters<typeof testClient>[0]>()
    .mockResolvedValueOnce(calls(["skill", "load_skill", { name: "reports" }]))
    .mockResolvedValueOnce(
      assistantMessage(Array.from({ length: 4 }, (_, i) => toolCall(`read-${i}`, "read", { large: i === 0 }))),
    )
    .mockImplementationOnce(async ({ messages }) => {
      const request = JSON.stringify(messages);
      expect(request).toContain("Verify every report against its sources.");
      expect(request).toContain("Build a report");
      expect(request).not.toContain("Large evidence ".repeat(1000));
      expect(request).toContain("tool output cleared to save context");
      return assistant("Verified");
    });
  const client = testClient(complete);
  const result = await run(
    client,
    "model",
    "",
    [user("Build a report")],
    [
      {
        name: "read",
        description: "Test tool",
        inputSchema: z.looseObject({ large: z.boolean().optional() }),
        execute: async (args) => output(args.large ? "Large evidence ".repeat(1000) : "Small evidence"),
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
      return assistant("Earlier evidence was verified.");
    }
    turns++;
    const request = JSON.stringify(options.messages);
    expect(request).toContain("untrusted-conversation-summary");
    expect(request).toContain("Current workspace");
    expect(request).not.toContain("Large evidence ".repeat(1000));
    return turns < 3 ? calls([`read-${turns}`, "read"]) : assistant("Done");
  });
  const client = testClient(complete);
  const execute = (messages: UIMessage[], model = "model") =>
    run(
      client,
      "model",
      "",
      messages,
      [{ name: "read", description: "Test tool", inputSchema: z.looseObject({}), execute: async () => output("Read") }],
      {
        threadId: "chat",
        sharedMiddleware: (signal) => [chatCompaction(client, 1000, model, signal, metadata)],
        prepareMessages: (messages) => prepareChatMessages(messages, "Current workspace: /"),
      },
    );
  const original: UIMessage[] = [
    user("Previous request"),
    assistant("Large evidence ".repeat(1000)),
    toolRoundMessage({ id: "render", name: "render", arguments: "{}" }, [
      mediaFromDataUrl("data:image/png;base64,YWJj", "report.png"),
    ]),
    user("Current request"),
  ];
  const first = await execute(original);
  expect(first.status).toBe("completed");
  expect(turns).toBe(3);
  expect(summaries).toBe(1);
  expect(entries.size).toBe(1);
  expect(JSON.stringify([...entries.values()])).toContain("[Image: report.png - displayed to user]");
  expect(JSON.stringify([...entries.values()])).not.toContain("YWJj");
  expect(JSON.stringify(first.messages)).toContain("YWJj");
  expect(JSON.stringify(first.messages)).toContain("Large evidence ".repeat(1000));
  expect(JSON.stringify(first.messages)).not.toContain("untrusted-conversation-summary");
  const restored: UIMessage[] = JSON.parse(JSON.stringify(first.messages));
  restored.push(userMessage("Follow up"));
  expect((await execute(restored)).status).toBe("completed");
  expect(summaries).toBe(1);
  restored[0] = { ...restored[0], parts: [{ type: "text", content: "Edited earlier request" }] };
  await execute(restored);
  expect(summaries).toBe(2);
  await execute(restored, "different-summarizer");
  expect(summaries).toBe(3);
});
