import { expect, it, vi } from "vitest";
import { inlineSkill, withSkills } from "@tanstack/ai-skills";
import { run } from "@/shared/lib/agent";
import { testClient } from "@/shared/lib/test-support/ai";
import { chatCompaction, preserveSkillContext } from "./chatCompaction";

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
