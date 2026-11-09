import { expect, it } from "vitest";
import { resolveDebugOption } from "@tanstack/ai/adapter-internals";
import { OpenAITextAdapter } from "@tanstack/ai-openai";
import { finished, response, textItem } from "./test-support/ai";
import { nativePhaseReplay } from "./test-support/tanstackPhases";

it("preserves native response item boundaries through UI persistence without a sidecar", async () => {
  const { saved, replay } = await nativePhaseReplay();
  expect(saved.at(-1)?.content).toBe("WorkingDone");
  expect(replay).toMatchObject([
    { id: "commentary", phase: "commentary", content: [{ text: "Working" }] },
    { id: "final", phase: "final_answer", content: [{ text: "Done" }] },
  ]);
});

it.each([
  { name: "matching counts with different boundaries", lengths: [7, 4], blocks: [3, 8], texts: ["Working", "Done"] },
  { name: "matching counts with empty commentary", lengths: [0, 11], blocks: [3, 8], texts: ["", "WorkingDone"] },
  ...[
    [undefined, 4],
    [-1, 12],
    [1.5, 9.5],
    [7, 5],
    [NaN, 4],
    [Infinity, 4],
    ["7", 4],
  ].flatMap((lengths) => [
    {
      name: `invalid lengths ${lengths.join("/")} with matching counts`,
      lengths,
      blocks: [3, 8],
      texts: ["Wor", "kingDone"],
    },
    {
      name: `invalid lengths ${lengths.join("/")} with different counts`,
      lengths,
      blocks: [11],
      texts: undefined,
    },
  ]),
])("replays saved response items: $name", async ({ lengths, blocks, texts }) => {
  const requests: { input: Record<string, unknown>[] }[] = [];
  const adapter = new OpenAITextAdapter(
    {
      apiKey: "test-key",
      dangerouslyAllowBrowser: true,
      fetch: async (input, init) => {
        requests.push(await new Request(input, init).json());
        return finished(response([textItem("Next")], { model: "gpt-5.5" }));
      },
    },
    "gpt-5.5",
  );
  for await (const _ of adapter.chatStream({
    threadId: "phase-test",
    logger: resolveDebugOption(false),
    model: "gpt-5.5",
    messages: [
      {
        role: "assistant",
        content: "WorkingDone",
        blockOrder: blocks.map((length) => ({ type: "text", length })),
        metadata: {
          tanstack: {
            responseItems: [
              { id: "commentary", phase: "commentary", textLength: lengths[0] },
              { id: "final", phase: "final_answer", textLength: lengths[1] },
            ],
          },
        },
      },
    ],
  })) {
    /* drain the real adapter to inspect its request */
  }
  expect(requests).toHaveLength(1);
  expect(requests[0].input).toEqual(
    texts
      ? [
          { ...textItem(texts[0]), id: "commentary", phase: "commentary" },
          { ...textItem(texts[1]), id: "final", phase: "final_answer" },
        ]
      : [{ type: "message", role: "assistant", content: "WorkingDone" }],
  );
});
