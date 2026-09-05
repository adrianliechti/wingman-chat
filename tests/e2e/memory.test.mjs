import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { GATEWAY_URL, messageText, REQUEST_TIMEOUT_MS, resultDetail, startGatewayHarness } from "./gateway-harness.mjs";

/**
 * Drives the production `memory` tool with a real model through the gateway:
 * turn one must persist a stated preference as a memory entry; turn two, in a
 * fresh conversation that only receives the memory index, must recall it.
 */

let harness;
let client;
let run;
let Role;
let selectedModel;
let memoryPrompt;
let createMemoryTools;
let createMemoryStore;
let createFakeMemoryFs;
let buildMemoryRuntimeContext;

function userTurn(text, runtimeContext) {
  return [
    {
      role: Role.User,
      content: [
        { type: "text", text },
        { type: "text", text: runtimeContext },
      ],
    },
  ];
}

void describe("Wingman memory tool E2E", { concurrency: false }, () => {
  before(
    async () => {
      harness = await startGatewayHarness();
      ({ client, run, Role } = harness);
      const requested = process.env.WINGMAN_E2E_MEMORY_MODEL ?? process.env.WINGMAN_E2E_MODEL;
      selectedModel =
        requested ??
        harness.availableModels.find((model) => model.id === "auto")?.id ??
        harness.availableModels.find((model) => model.type === "completer")?.id;
      assert(selectedModel, `No completion model is exposed by ${GATEWAY_URL}`);

      ({ createMemoryTools } = await harness.vite.ssrLoadModule("/src/features/agent/lib/memoryTools.ts"));
      ({ createMemoryStore } = await harness.vite.ssrLoadModule("/src/features/agent/lib/memoryStore.ts"));
      ({ createFakeMemoryFs } = await harness.vite.ssrLoadModule("/src/features/agent/lib/memoryTestUtils.ts"));
      ({ buildMemoryRuntimeContext } = await harness.vite.ssrLoadModule("/src/features/agent/lib/memoryContext.ts"));
      memoryPrompt = (await harness.vite.ssrLoadModule("/src/features/agent/prompts/memory.txt?raw")).default;
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  after(async () => harness?.close());

  void test(
    "a real model saves a stated preference and recalls it from the index in a later conversation",
    async () => {
      const { fs, files } = createFakeMemoryFs();
      const store = createMemoryStore(fs, { dir: "agents/e2e/memory" });
      await store.ensureMigrated();
      const calls = [];
      const [tool] = createMemoryTools({ store });
      const tracked = { ...tool, function: async (args, context) => (calls.push(args), tool.function(args, context)) };
      const instructions = `You are a helpful assistant.\n\n${memoryPrompt}`;

      const first = await run(
        client,
        selectedModel,
        instructions,
        userTurn(
          "For future reference: I always want code examples in Go, never Python. Just acknowledge briefly.",
          buildMemoryRuntimeContext(await store.readIndex()),
        ),
        [tracked],
        { agentName: "memory-e2e", maxTurns: 4 },
      );
      assert.equal(first.status, "completed", resultDetail(first));

      const writes = calls
        .flatMap((args) => (Array.isArray(args.ops) ? args.ops : []))
        .filter((op) => op.op === "write");
      assert(writes.length >= 1, `Model never wrote memory. Calls: ${JSON.stringify(calls)}`);
      const entries = await store.list();
      assert(entries.length >= 1, "No memory entry landed in the store");
      const saved = [...files.entries()]
        .filter(([path]) => path.startsWith("agents/e2e/memory/") && !/index\.md|log\.md$/.test(path))
        .map(([, file]) => file.content)
        .join("\n");
      assert.match(saved, /\bGo\b/, `Saved memory does not mention Go:\n${saved}`);
      assert.match(saved, /^---\ntype: /m, "Saved entry is missing normalized frontmatter");

      // Fresh conversation: only the index is injected, the body must be read or inferred.
      const second = await run(
        client,
        selectedModel,
        instructions,
        userTurn(
          "Which programming language should you use for my code examples? Answer with the language name only.",
          buildMemoryRuntimeContext(await store.readIndex()),
        ),
        [tracked],
        { agentName: "memory-e2e", maxTurns: 4 },
      );
      assert.equal(second.status, "completed", resultDetail(second));
      assert.match(messageText(second.messages), /\bGo\b/i, `Model did not recall Go: ${messageText(second.messages)}`);
    },
    { timeout: REQUEST_TIMEOUT_MS * 4 },
  );
});
