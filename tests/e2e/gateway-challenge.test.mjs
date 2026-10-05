import { z } from "zod";
import assert from "node:assert/strict";
import { convertSchemaToJsonSchema, maxIterations } from "@tanstack/ai";
import { execFile } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";
import { createArtifactWorkspace } from "./artifact-workspace.mjs";
import {
  assertModelsAvailable,
  contentParts,
  createResponseFaultInjector,
  lastAssistantText,
  nativeMessage,
  chunkTypes,
  observeRun,
  REQUEST_TIMEOUT_MS,
  resultDetail,
  startGatewayHarness,
} from "./gateway-harness.mjs";

const execFileAsync = promisify(execFile);
const PYTHON = process.env.WINGMAN_E2E_PYTHON ?? "python3";
const configuredModels = (process.env.WINGMAN_E2E_CHALLENGE_MODELS ?? "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const modelCases = configuredModels.length
  ? configuredModels.map((model) => ({ label: model, candidates: [model] }))
  : [
      {
        label: "sonnet-4.6 (Bedrock preferred)",
        candidates: ["bedrock-sonnet-4-6", "claude-sonnet-4-6"],
      },
      { label: "gpt-5.4", candidates: ["gpt-5.4"] },
    ];
const faults = createResponseFaultInjector();

let modelIds = [];
let harness;
let client;
let run;
let Role;
let fileToolsModule;
let validatorsModule;
let verifierModule;
let executionSchemasModule;
let questionsToolModule;
let artifactModule;
let toolSchemasModule;

function user(text) {
  return { role: Role.User, content: [{ type: "text", text }] };
}

function assertEventContract(events, result) {
  assert.equal(events[0]?.type, "RUN_STARTED");
  if (result.status === "completed") assert.equal(events.at(-1)?.type, "RUN_FINISHED");
  if (result.status === "failed") assert(chunkTypes(events).includes("RUN_ERROR"));
}

function resultTexts(messages, toolName) {
  return contentParts(messages, "tool_result")
    .filter((part) => !toolName || part.name === toolName)
    .flatMap((part) => part.metadata?.result ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.content);
}

function productionFileTools(workspace) {
  return fileToolsModule.createFileTools(workspace.source, {
    namespace: "artifacts",
    validators: validatorsModule.ARTIFACT_VALIDATORS,
  });
}

void describe("Wingman real-model challenge E2E", { concurrency: false }, () => {
  before(
    async () => {
      harness = await startGatewayHarness({ plugins: [faults.plugin] });
      ({ client, run, Role } = harness);
      const available = new Set(harness.availableModels.map((model) => model.id));
      modelIds = modelCases.map(({ label, candidates }) => {
        const selected = candidates.find((candidate) => available.has(candidate));
        assert(selected, `${label} is unavailable. Tried: ${candidates.join(", ")}`);
        return selected;
      });
      assertModelsAvailable(harness.availableModels, modelIds);

      // pdfjs accesses DOMMatrix while the verifier module initializes. A real
      // browser supplies it; JSON/HTML challenge artifacts never instantiate it.
      globalThis.DOMMatrix ??= class DOMMatrix {};
      fileToolsModule = await harness.vite.ssrLoadModule("/src/shared/lib/file-tools.ts");
      validatorsModule = await harness.vite.ssrLoadModule("/src/features/artifacts/lib/artifactValidators.ts");
      verifierModule = await harness.vite.ssrLoadModule("/src/features/artifacts/lib/artifact-verifier.ts");
      executionSchemasModule = await harness.vite.ssrLoadModule("/src/features/artifacts/lib/executionToolSchemas.ts");
      questionsToolModule = await harness.vite.ssrLoadModule("/src/features/chat/lib/questionsTool.ts");
      artifactModule = await harness.vite.ssrLoadModule("/src/shared/types/artifact.ts");
      toolSchemasModule = await harness.vite.ssrLoadModule("/src/shared/lib/test-support/toolSchemas.ts");

      await execFileAsync(PYTHON, ["--version"], { timeout: 10_000 });
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  after(async () => harness?.close());

  void test("requires both configured challenge models", () => {
    assert(modelIds.length >= 1);
    assertModelsAvailable(harness.availableModels, modelIds);
  });

  for (const [modelIndex, modelCase] of modelCases.entries()) {
    void describe(modelCase.label, { concurrency: false }, () => {
      void test(
        "reports an interrupted native stream and permits a fresh run without duplicated output",
        async () => {
          const model = modelIds[modelIndex];
          const partialMarker = "STREAM_RETRY_PARTIAL_SENTINEL";
          const beforeFault = faults.snapshot();
          const streamSnapshots = [];
          const events = [];
          faults.dropNext({ waitForText: partialMarker });

          const result = await run(
            client,
            model,
            `This is a retry test. Begin with exactly ${partialMarker}, write two short sentences, and end with exactly STREAM_RETRY_OK.`,
            [user("Exercise the retryable response stream now.")],
            [],
            {
              agentName: "challenge-stream-retry",
              agentLoopStrategy: maxIterations(1),
              middleware: [
                observeRun(events),
                {
                  onChunk: (_ctx, chunk) => {
                    if (chunk.type === "TEXT_MESSAGE_CONTENT") streamSnapshots.push(chunk.delta);
                  },
                },
              ],
            },
          );

          const afterFault = faults.snapshot();
          assert.equal(result.status, "failed", resultDetail(result));
          assert.equal(afterFault.droppedCount - beforeFault.droppedCount, 1);
          assert.equal(
            afterFault.requestCount - beforeFault.requestCount,
            1,
            "A partially streamed request must not be silently replayed",
          );
          assert(
            streamSnapshots.some((content) => content.length > 0),
            "The injected attempt did not stream a partial response",
          );
          assert.equal(events.modelCalls, 1);

          const retry = await run(
            client,
            model,
            `Begin with exactly ${partialMarker}, write two short sentences, and end with exactly STREAM_RETRY_OK.`,
            [user("Retry the interrupted request.")],
            [],
            { agentLoopStrategy: maxIterations(1) },
          );
          assert.equal(retry.status, "completed", resultDetail(retry));
          const finalText = lastAssistantText(retry.messages);
          assert.match(finalText, /STREAM_RETRY_OK/);
          assert.equal(finalText.split(partialMarker).length - 1, 1, "The failed run's text leaked into a fresh run");
          assertEventContract(events, result);
        },
        { timeout: REQUEST_TIMEOUT_MS * 3 },
      );

      void test(
        "self-corrects a transient tool failure and obeys runtime verification feedback",
        async () => {
          const model = modelIds[modelIndex];
          const marker = `RECOVERY_${model.replaceAll(/[^A-Za-z0-9]/g, "_").toUpperCase()}_OK`;
          const attempts = [];
          const events = [];
          const metaUpdates = [];
          let verificationCount = 0;
          const tool = {
            name: "unstable_fixture",
            description:
              "Fetch a deterministic fixture. Start with attempt 1; if it reports a transient failure, increment attempt and retry.",

            inputSchema: z.fromJSONSchema({
              type: "object",
              properties: { attempt: { type: "integer" } },
              required: ["attempt"],
              additionalProperties: false,
            }),
            execute: async (args, execution) => {
              const context = execution?.context;
              attempts.push(args.attempt);
              context.setMeta?.({ phase: "attempt", attempt: args.attempt });
              if (attempts.length === 1) {
                throw new Error("TRANSIENT_E2E_FAILURE: retry unstable_fixture with attempt 2");
              }
              assert.equal(args.attempt, 2);
              context.setMeta?.({ phase: "recovered", attempt: args.attempt, marker });
              return [{ type: "text", content: marker }];
            },
          };

          const result = await run(
            client,
            model,
            `Call unstable_fixture with attempt 1. If it fails, follow its retry instruction. After it succeeds, reply with its marker. Verification feedback follows tool execution; follow that feedback exactly.`,
            [user("Recover the unstable fixture.")],
            [tool],
            {
              agentName: "challenge-tool-recovery",
              agentLoopStrategy: maxIterations(6),
              middleware: [
                observeRun(events),
                {
                  onConfig: (ctx, config) => {
                    if (ctx.phase !== "beforeModel" || !attempts.length) return;
                    verificationCount++;
                    const feedback =
                      attempts.length < 2
                        ? "The fixture has not recovered. Retry its tool now."
                        : `Verifier correction: reply with exactly ${marker} and no other text.`;
                    return {
                      providerMessages: [
                        ...(config.providerMessages ?? config.messages),
                        { role: "user", content: feedback },
                      ],
                    };
                  },
                },
              ],
              onToolMeta: (_id, meta) => metaUpdates.push(meta),
            },
          );

          assert.equal(result.status, "completed", resultDetail(result));
          assert.deepEqual(attempts, [1, 2]);
          assert.match(lastAssistantText(result.messages), new RegExp(marker));
          assert.equal(verificationCount, 2);
          assert(
            !result.messages.some((message) =>
              message.parts.some((part) => part.type === "text" && part.content.includes("Verifier correction")),
            ),
            "Provider-only verification must not become a user message",
          );
          const results = contentParts(result.messages, "tool_result").filter((part) => part.name === tool.name);
          assert.equal(results.length, 2);
          assert.equal(results[0].state, "error");
          assert.match(results[0].content, /TRANSIENT_E2E_FAILURE/);
          assert.equal(results[0].id, contentParts(result.messages, "tool_call")[0].id);
          assert.equal(results[1].id, contentParts(result.messages, "tool_call")[1].id);
          assert(metaUpdates.some((meta) => meta.phase === "recovered"));
          assertEventContract(events, result);
        },
        { timeout: REQUEST_TIMEOUT_MS * 4 },
      );

      void test(
        "shares cancellation while using independent native limits for a nested agent",
        async () => {
          const model = modelIds[modelIndex];
          const parentEvents = [];
          const childEvents = [];
          let childResult;
          const childMarker = `CHILD_${model.replaceAll(/[^A-Za-z0-9]/g, "_").toUpperCase()}_OK`;
          const delegate = {
            name: "delegate_fixture",
            description: "Delegate the deterministic fixture lookup to a child agent.",

            inputSchema: z.fromJSONSchema({
              type: "object",
              properties: { task: { type: "string" } },
              required: ["task"],
              additionalProperties: false,
            }),
            execute: async (_args, execution) => {
              const context = execution?.context;
              assert(context.invocationContext, "The tool did not receive the shared invocation context");
              childResult = await run(
                client,
                model,
                `Reply with exactly ${childMarker} and no other text.`,
                [user("Resolve the delegated fixture.")],
                [],
                {
                  agentName: "challenge-child",
                  context: { ...context.invocationContext, subagentRunId: crypto.randomUUID() },
                  agentLoopStrategy: maxIterations(1),
                  middleware: [observeRun(childEvents)],
                },
              );
              assert.equal(childResult.status, "completed", resultDetail(childResult));
              return [{ type: "text", content: lastAssistantText(childResult.messages) }];
            },
          };

          const result = await run(
            client,
            model,
            `Call delegate_fixture exactly once. After it returns, reply with exactly its marker and no other text.`,
            [user("Delegate this fixture.")],
            [delegate],
            {
              agentName: "challenge-parent",
              agentLoopStrategy: maxIterations(3),
              middleware: [observeRun(parentEvents)],
            },
          );

          assert.equal(result.status, "completed", resultDetail(result));
          assert.match(lastAssistantText(result.messages), new RegExp(childMarker));
          assert.equal(parentEvents.modelCalls, 2);
          assert.equal(childEvents.modelCalls, 1);
          assert.notEqual(parentEvents[0].runId, childEvents[0].runId);
          assertEventContract(parentEvents, result);
          assertEventContract(childEvents, childResult);
        },
        { timeout: REQUEST_TIMEOUT_MS * 4 },
      );

      void test(
        "aborts while a model-selected tool is running without committing a tool result",
        async () => {
          const model = modelIds[modelIndex];
          const controller = new AbortController();
          const events = [];
          let toolStarted = false;
          const waitTool = {
            name: "wait_for_release",
            description: "Wait until the caller releases or cancels this operation.",

            inputSchema: z.fromJSONSchema({
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            }),
            execute: async (_args, execution) => {
              const context = execution?.context;
              toolStarted = true;
              const signal = context.signal;
              assert(signal, "The tool did not receive the run's abort signal");
              const timer = setTimeout(() => controller.abort("Challenge tool cancellation"), 20);
              try {
                await new Promise((resolve, reject) => {
                  if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
                  signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
                    once: true,
                  });
                });
              } finally {
                clearTimeout(timer);
              }
              return [{ type: "text", content: "SHOULD_NOT_COMMIT" }];
            },
          };

          const result = await run(
            client,
            model,
            "You MUST call wait_for_release immediately. Do not reply with text first.",
            [user("Wait for release.")],
            [waitTool],
            {
              agentName: "challenge-tool-abort",
              agentLoopStrategy: maxIterations(2),
              options: { signal: controller.signal },
              middleware: [observeRun(events)],
            },
          );

          assert(toolStarted, "The model did not select the required tool");
          assert.equal(result.status, "aborted");
          assert.equal(contentParts(result.messages, "tool_result").length, 0);
          assert.equal(contentParts(result.messages, "tool_call").length, 1);
          assert.equal(chunkTypes(events).filter((type) => type === "TOOL_CALL_START").length, 1);
          assert(!chunkTypes(events).includes("TOOL_CALL_RESULT"));
          assertEventContract(events, result);
        },
        { timeout: REQUEST_TIMEOUT_MS * 2 },
      );

      void test(
        "stops a deliberately runaway tool loop at the turn budget",
        async () => {
          const model = modelIds[modelIndex];
          const calls = [];
          const loopTool = {
            name: "continue_loop",
            description: "Return the next loop step. The test requires another call after every result.",

            inputSchema: z.fromJSONSchema({
              type: "object",
              properties: { step: { type: "integer" } },
              required: ["step"],
              additionalProperties: false,
            }),
            execute: async (args) => {
              calls.push(args.step);
              return [
                { type: "text", content: `Step ${args.step} complete. Call continue_loop with step ${args.step + 1}.` },
              ];
            },
          };

          const result = await run(
            client,
            model,
            "Start continue_loop at step 1 and ALWAYS call it again with the next step after every result. Never finish with text.",
            [user("Start the bounded loop.")],
            [loopTool],
            { agentName: "challenge-loop-budget", agentLoopStrategy: maxIterations(2) },
          );

          assert.equal(result.status, "completed");
          assert.deepEqual(calls, [1, 2]);
          assert.equal(contentParts(result.messages, "tool_result").length, 2);
        },
        { timeout: REQUEST_TIMEOUT_MS * 3 },
      );

      void test(
        "executes quote-heavy multiline Python through the production Bedrock-compatible schema",
        async () => {
          const model = modelIds[modelIndex];
          const workspace = await createArtifactWorkspace(artifactModule);
          const parsedCalls = [];
          try {
            const pythonTool = {
              name: "execute_script",
              description:
                "Execute inline Python. Set language to python, pass code as one JSON string and omit path when unused.",

              inputSchema: executionSchemasModule.SCRIPT_EXECUTION_SCHEMA,
              execute: async (args, execution) => {
                const context = execution?.context;
                parsedCalls.push(args);
                assert.equal(typeof args.code, "string");
                assert.equal(args.language, "python");
                assert(args.path === undefined || args.path === "");
                assert.equal(args.skills, undefined);
                const { stdout, stderr } = await execFileAsync(PYTHON, ["-I", "-c", args.code], {
                  timeout: 15_000,
                  maxBuffer: 1024 * 1024,
                });
                context.setContent?.({ exitCode: 0, stderr });
                return [{ type: "text", content: stdout.trim() }];
              },
            };
            const tools = [...productionFileTools(workspace), pythonTool, questionsToolModule.ASK_QUESTIONS_TOOL];
            assert.equal(
              tools.reduce(
                (count, tool) =>
                  count + toolSchemasModule.countSchemaUnions(convertSchemaToJsonSchema(tool.inputSchema)),
                0,
              ),
              0,
            );

            const expected = {
              lines: ["alpha", "beta"],
              path: "C:\\tmp\\wingman",
              quote: 'He said "Bedrock\\JSON"',
              unicode: "Grüezi 🪽",
            };
            const result = await run(
              client,
              model,
              `Call execute_script exactly once with language="python" and inline Python that constructs this object and prints json.dumps(value, ensure_ascii=False, sort_keys=True): ${JSON.stringify(expected)}. The code must include an import, a multiline object literal, nested quotes, backslashes, and Unicode. Omit path because it is unused. Do not call any file or JavaScript tools. After execution, reply with exactly the printed JSON.`,
              [user("Run the quote-heavy Python JSON fixture.")],
              tools,
              { agentName: "challenge-python-schema", agentLoopStrategy: maxIterations(3) },
            );

            assert.equal(result.status, "completed", resultDetail(result));
            assert.equal(parsedCalls.length, 1);
            const output = resultTexts(result.messages, "execute_script").at(-1);
            assert.deepEqual(JSON.parse(output), expected);
            assert.deepEqual(JSON.parse(lastAssistantText(result.messages)), expected);
            const call = contentParts(result.messages, "tool_call").find((part) => part.name === "execute_script");
            assert(call, "The transcript is missing the Python tool call");
            assert.doesNotThrow(() => JSON.parse(call.arguments), "The provider emitted malformed tool-call JSON");
          } finally {
            await workspace.cleanup();
          }
        },
        { timeout: REQUEST_TIMEOUT_MS * 4 },
      );

      void test(
        "repairs an invalid structured artifact and verifies the resulting files",
        async () => {
          const model = modelIds[modelIndex];
          const workspace = await createArtifactWorkspace(artifactModule, {
            "/brief.txt": "TOKEN=ORBIT-731\n",
          });
          try {
            const events = [];
            const tools = productionFileTools(workspace);
            const result = await run(
              client,
              model,
              `Complete this exact artifact workflow with the file tools:
1. Read /brief.txt and use its token.
2. Create /result.json with the intentionally invalid content {"token":"ORBIT-731",}.
3. Observe the JSON validation error, inspect /result.json, then repair it with artifacts_edit so its final JSON is exactly {"token":"ORBIT-731","status":"ready","value":42}.
4. Create /assets/note.txt containing exactly source=ORBIT-731, then move it to /sources/note.txt.
5. List all files with artifacts_glob using the pattern **/* and only then reply with exactly ARTIFACT_WORKFLOW_OK.
Do not skip the intentional invalid write or its edit repair.`,
              [user("Build and validate the artifact fixture.")],
              tools,
              {
                agentName: "challenge-artifact-workflow",
                agentLoopStrategy: maxIterations(10),
                middleware: [observeRun(events)],
              },
            );

            assert.equal(result.status, "completed", resultDetail(result));
            assert.match(lastAssistantText(result.messages), /ARTIFACT_WORKFLOW_OK/);
            assert.deepEqual(JSON.parse((await workspace.read("/result.json")).content), {
              token: "ORBIT-731",
              status: "ready",
              value: 42,
            });
            assert.equal((await workspace.read("/sources/note.txt")).content, "source=ORBIT-731");
            assert.equal(await workspace.read("/assets/note.txt"), undefined);

            const names = contentParts(result.messages, "tool_call").map((part) => part.name);
            for (const required of [
              "artifacts_read",
              "artifacts_create",
              "artifacts_edit",
              "artifacts_move",
              "artifacts_glob",
            ]) {
              assert(names.includes(required), `The workflow never called ${required}`);
            }
            assert(
              resultTexts(result.messages, "artifacts_create").some((text) => text.includes("validation errors")),
              "The intentionally invalid JSON did not surface validation feedback",
            );
            assert(
              workspace.mutations.some(
                (mutation) => mutation.operation === "update" && mutation.path === "/result.json",
              ),
            );
            assert(workspace.mutations.some((mutation) => mutation.operation === "move"));

            const deltas = contentParts(result.messages, "tool_result")
              .map((part) => artifactModule.artifactDeltaFromMeta(part.meta))
              .filter(Boolean);
            assert(deltas.length >= 4);
            assert(deltas.flatMap((delta) => delta.mutations).every((mutation) => mutation.revision));

            const checks = await verifierModule.verifyArtifacts(workspace.artifactFs, [
              "/result.json",
              "/sources/note.txt",
            ]);
            assert(
              checks.every((check) => check.status === "pass"),
              JSON.stringify(checks),
            );
            assertEventContract(events, result);
          } finally {
            await workspace.cleanup();
          }
        },
        { timeout: REQUEST_TIMEOUT_MS * 8 },
      );
    });
  }

  void test(
    "aborting an interrupted stream prevents a second gateway request",
    async () => {
      const model = modelIds[0];
      const controller = new AbortController();
      const prompt = user("Begin the retry cancellation fixture.");
      const beforeFault = faults.snapshot();
      faults.dropNext({ onDrop: () => controller.abort("Cancel during retry recovery") });

      const result = await run(
        client,
        model,
        "Write a long sentence ending with RETRY_ABORT_SHOULD_NOT_COMMIT.",
        [prompt],
        [],
        {
          agentName: "challenge-retry-abort",
          agentLoopStrategy: maxIterations(1),
          options: { signal: controller.signal },
        },
      );

      const afterFault = faults.snapshot();
      assert.equal(result.status, "aborted");
      assert.deepEqual(result.messages[0]?.parts, nativeMessage(prompt).parts);
      assert.equal(contentParts(result.messages, "tool_result").length, 0);
      assert.equal(afterFault.droppedCount - beforeFault.droppedCount, 1);
      assert.equal(afterFault.requestCount - beforeFault.requestCount, 1, "An aborted retry issued another request");
    },
    { timeout: REQUEST_TIMEOUT_MS * 2 },
  );
});
