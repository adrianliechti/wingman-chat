import assert from "node:assert/strict";
import { convertSchemaToJsonSchema, maxIterations } from "@tanstack/ai";
import { Document, Packer, Paragraph } from "docx";
import { z } from "zod";
import { after, before, describe, test } from "node:test";
import {
  GATEWAY_URL,
  createResponseFaultInjector,
  contentParts,
  chunkTypes,
  observeRun,
  messageText,
  nativeMessage,
  REQUEST_TIMEOUT_MS,
  resultDetail,
  startGatewayHarness,
} from "./gateway-harness.mjs";

let harness;
let client;
let run;
let Role;
let selectedModel;
let availableModels;
const compatibilityModel = process.env.WINGMAN_E2E_COMPATIBILITY_MODEL ?? "gpt-5.4-mini";
const documentModel = process.env.WINGMAN_E2E_DOCUMENT_MODEL ?? "claude-sonnet-4-6";
const faults = createResponseFaultInjector();

void describe("Wingman gateway E2E", { concurrency: false }, () => {
  before(
    async () => {
      harness = await startGatewayHarness({ plugins: [faults.plugin] });
      ({ client, run, Role, availableModels } = harness);
      const requestedModel = process.env.WINGMAN_E2E_MODEL;
      if (requestedModel) {
        assert(
          availableModels.some((model) => model.id === requestedModel),
          `WINGMAN_E2E_MODEL=${requestedModel} is not exposed by ${GATEWAY_URL}`,
        );
        selectedModel = requestedModel;
      } else {
        selectedModel =
          availableModels.find((model) => model.id === "auto")?.id ??
          availableModels.find((model) => model.id === "claude-sonnet-4-6")?.id ??
          availableModels.find((model) => model.id === "gpt-5.4-mini")?.id ??
          availableModels.find((model) => model.type === "completer")?.id;
      }
      assert(selectedModel, `No completion model is exposed by ${GATEWAY_URL}`);
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  after(async () => harness?.close());

  void test("discovers models through the application client and development proxy", () => {
    assert(availableModels.length > 0);
    assert(availableModels.some((model) => model.id === selectedModel));
  });

  for (const model of new Set([compatibilityModel, documentModel, "claude-opus-5-5", "claude-haiku-5-5"])) {
    void test(
      `displays reasoning by default with ${model} and replays it after persistence`,
      async (context) => {
        if (!availableModels.some((available) => available.id === model)) {
          context.skip(`${model} is not exposed by ${GATEWAY_URL}`);
          return;
        }
        const events = [];
        const first = await run(
          client,
          model,
          "Think carefully, verify the result, then return only the numeric answer.",
          [
            {
              role: Role.User,
              content: [
                {
                  type: "text",
                  text: "Find the smallest positive integer x such that x mod 7 = 3, x mod 11 = 5, and x mod 13 = 7.",
                },
              ],
            },
          ],
          [],
          {
            options: {
              // Exercise the provider default on a model that thinks by default.
              ...(["claude-opus-5-5", "claude-haiku-5-5"].includes(model) ? {} : { effort: "high" }),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            },
            middleware: [observeRun(events)],
          },
        );
        assert.equal(first.status, "completed", resultDetail(first));
        const visible = contentParts(first.messages, "reasoning").filter((part) => part.text || part.summary);
        assert(visible.length > 0, `${model} did not return visible reasoning with default chat settings`);
        assert(
          visible.some((part) => part.encryptedContent),
          `${model} did not return signed reasoning`,
        );
        assert(
          events.some((chunk) => chunk.type === "REASONING_MESSAGE_CONTENT" && chunk.delta),
          `${model} did not stream visible reasoning`,
        );
        const restored = JSON.parse(JSON.stringify(first.messages));
        const beforeReplay = faults.snapshot().requestCount;
        const second = await run(
          client,
          model,
          "Return only the numeric answer.",
          [...restored, { role: Role.User, content: [{ type: "text", text: "What is that answer plus one?" }] }],
          [],
          { options: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } },
        );
        assert.equal(second.status, "completed", resultDetail(second));
        assert.equal(faults.snapshot().requestCount - beforeReplay, 1, "Reasoning replay needed a recovery retry");
        assert(
          contentParts(second.messages, "reasoning").some((part) => part.text || part.summary),
          "Persisted reasoning disappeared on the next turn",
        );
      },
      { timeout: REQUEST_TIMEOUT_MS * 2 },
    );
  }

  for (const model of new Set([compatibilityModel, documentModel])) {
    void test(
      `reads an inline Office attachment with ${model} and replays it after persistence`,
      async (context) => {
        if (!availableModels.some((available) => available.id === model)) {
          context.skip(`${model} is not exposed by ${GATEWAY_URL}`);
          return;
        }
        const marker = "OFFICE_ATTACHMENT_63B9";
        const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(marker)] }] }));
        const contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const result = await run(
          client,
          model,
          "Return only the exact marker inside the attached document.",
          [
            {
              role: Role.User,
              content: [
                { type: "text", text: "Read the attached Office document." },
                {
                  type: "file",
                  name: "fixture.docx",
                  contentType,
                  data: `data:${contentType};base64,${bytes.toString("base64")}`,
                },
              ],
            },
          ],
          [],
          { options: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } },
        );
        assert.equal(result.status, "completed", resultDetail(result));
        assert.match(messageText(result.messages.slice(-1)), new RegExp(marker));
        const continued = await run(
          client,
          model,
          "Return only the exact marker inside the attached document.",
          [
            ...JSON.parse(JSON.stringify(result.messages)),
            { role: Role.User, content: [{ type: "text", text: "Repeat the marker from the document." }] },
          ],
          [],
          { options: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } },
        );
        assert.equal(continued.status, "completed", resultDetail(continued));
        assert.match(messageText(continued.messages.slice(-1)), new RegExp(marker));
      },
      { timeout: REQUEST_TIMEOUT_MS * 2 },
    );
  }

  void test(
    "reads a raw CSV attachment through the Bedrock document path",
    async (context) => {
      if (!availableModels.some((model) => model.id === documentModel)) {
        context.skip(`${documentModel} is not exposed by ${GATEWAY_URL}`);
        return;
      }
      const marker = "CSV_ATTACHMENT_B49A";
      const data = Buffer.from(`marker\n${marker}\n`).toString("base64");
      const result = await run(
        client,
        documentModel,
        "Return only the exact marker inside the attached document.",
        [
          {
            role: Role.User,
            content: [
              { type: "text", text: "Read the attached CSV document." },
              { type: "file", name: "fixture.csv", contentType: "text/csv", data: `data:text/csv;base64,${data}` },
            ],
          },
        ],
        [],
        { options: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } },
      );
      assert.equal(result.status, "completed", resultDetail(result));
      assert.match(messageText(result.messages.slice(-1)), new RegExp(marker));
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  void test(
    "validates structured output through the gateway with optional and nullable fields",
    async () => {
      const schema = z.object({ answer: z.string(), omitted: z.string().optional(), nullable: z.string().nullable() });
      const result = await client.parse(
        selectedModel,
        'Return answer="STRUCTURED_8D17", omit omitted, and set nullable=null.',
        "Produce the requested result.",
        schema,
        "e2e_compatibility",
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      assert.deepEqual(result, { answer: "STRUCTURED_8D17", nullable: null });
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  void test(
    "replays signed reasoning after persistence and continues after switching models",
    async (context) => {
      if (!availableModels.some((model) => model.id === compatibilityModel)) {
        context.skip(`${compatibilityModel} is not exposed by ${GATEWAY_URL}`);
        return;
      }
      const other =
        selectedModel !== compatibilityModel
          ? selectedModel
          : availableModels.find((model) => model.id === "claude-sonnet-4-6")?.id;
      assert(other, "Model-switch fixture requires a second model alongside the compatibility model");
      const options = { effort: "medium", summary: "auto", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
      const first = await run(
        client,
        compatibilityModel,
        "Follow the user's instructions; return only the numeric answer.",
        [{ role: Role.User, content: [{ type: "text", text: "What is 17 times 19?" }] }],
        [],
        { options },
      );
      assert.equal(first.status, "completed", resultDetail(first));
      const signed = contentParts(first.messages, "reasoning").filter((part) => part.encryptedContent);
      assert(signed.length > 0, "The reasoning-enabled deployment did not return a replayable reasoning item");
      assert(signed.every((part) => part.model === compatibilityModel));
      const restored = JSON.parse(JSON.stringify(first.messages));
      const beforeReplay = faults.snapshot().requestCount;
      const second = await run(
        client,
        compatibilityModel,
        "Follow the user's instructions; return only the numeric answer.",
        [...restored, { role: Role.User, content: [{ type: "text", text: "What is that answer plus one?" }] }],
        [],
        {
          options: { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
          prepareMessages: (messages) => messages,
        },
      );
      assert.equal(second.status, "completed", resultDetail(second));
      assert.match(messageText(second.messages.slice(-1)), /324/);
      assert.equal(
        faults.snapshot().requestCount - beforeReplay,
        1,
        "Signed reasoning was rejected and needed a recovery retry",
      );
      const beforeSwitch = faults.snapshot().requestCount;
      const switched = await run(
        client,
        other,
        "Return only the numeric answer.",
        [
          ...JSON.parse(JSON.stringify(second.messages)),
          { role: Role.User, content: [{ type: "text", text: "Repeat the last numeric answer." }] },
        ],
        [],
        { options: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } },
      );
      assert.equal(switched.status, "completed", resultDetail(switched));
      assert.match(messageText(switched.messages.slice(-1)), /324/);
      assert.equal(
        faults.snapshot().requestCount - beforeSwitch,
        1,
        "The model switch sent incompatible reasoning and needed recovery",
      );
    },
    { timeout: REQUEST_TIMEOUT_MS * 3 },
  );

  void test(
    "reports a dropped native response stream and accepts an explicit retry",
    async () => {
      const marker = "WINGMAN_RECOVERY_OK";
      const before = faults.snapshot();
      const snapshots = [];
      faults.dropNext();
      const result = await run(
        client,
        selectedModel,
        `Reply with exactly ${marker}.`,
        [{ role: Role.User, content: [{ type: "text", text: "Run the recovery fixture." }] }],
        [],
        {
          agentLoopStrategy: maxIterations(1),
          middleware: [
            {
              onChunk: (_ctx, chunk) => {
                if (chunk.type === "TEXT_MESSAGE_CONTENT") snapshots.push(chunk.delta);
              },
            },
          ],
          options: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        },
      );
      assert.equal(result.status, "failed", resultDetail(result));
      assert.equal(faults.snapshot().droppedCount - before.droppedCount, 1);
      assert.equal(faults.snapshot().requestCount - before.requestCount, 1);
      assert(
        snapshots.some((content) => content.length > 0),
        "No partial answer was observed",
      );
      const retry = await run(
        client,
        selectedModel,
        `Reply with exactly ${marker}.`,
        [{ role: Role.User, content: [{ type: "text", text: "Retry the request." }] }],
        [],
        { agentLoopStrategy: maxIterations(1), options: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } },
      );
      assert.equal(retry.status, "completed", resultDetail(retry));
      assert.equal(messageText(retry.messages.slice(-1)).trim(), marker);
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  void test(
    "compacts history with a real summarizer and continues from the summary",
    async () => {
      const { chatCompaction } = await harness.vite.ssrLoadModule("/src/features/chat/lib/chatCompaction.ts");
      const marker = "WINGMAN_COMPACT_91B7";
      const messages = [
        { role: Role.User, content: [{ type: "text", text: `Remember this exact marker for later: ${marker}` }] },
        {
          role: Role.Assistant,
          content: [{ type: "text", text: "The marker is saved. Redundant background material. ".repeat(200) }],
        },
        { role: Role.User, content: [{ type: "text", text: "Return the exact marker from earlier. Nothing else." }] },
      ];
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      let prepared;
      const result = await run(client, selectedModel, "Follow the user's instructions.", messages, [], {
        middleware: [
          chatCompaction(client, 512, selectedModel, signal),
          {
            onConfig: (ctx, config) => {
              if (ctx.phase === "beforeModel") prepared = config.providerMessages;
            },
          },
        ],
        agentLoopStrategy: maxIterations(1),
        options: { signal },
      });
      assert.equal(result.status, "completed", resultDetail(result));
      assert(prepared, "Native compaction did not prepare a smaller provider context");
      assert(!JSON.stringify(prepared).includes("Redundant background material. The marker"));
      assert.equal(messageText([result.messages[1]]), messages[1].content[0].text, "Original history must be retained");
      assert.match(messageText(result.messages.slice(-1)), new RegExp(marker));
    },
    { timeout: REQUEST_TIMEOUT_MS * 2 },
  );

  void test(
    "streams a complete agent turn with native lifecycle events",
    async () => {
      const events = [];
      const result = await run(
        client,
        selectedModel,
        "This is a transport test. Reply with exactly WINGMAN_E2E_OK and no other text.",
        [{ role: Role.User, content: [{ type: "text", text: "Run the transport test." }] }],
        [],
        { agentName: "gateway-e2e", middleware: [observeRun(events)], agentLoopStrategy: maxIterations(1) },
      );

      assert.equal(result.status, "completed", resultDetail(result));
      assert.match(messageText(result.messages), /WINGMAN_E2E_OK/i);
      assert.equal(events[0]?.type, "RUN_STARTED");
      assert.equal(events.at(-1)?.type, "RUN_FINISHED");
      assert(chunkTypes(events).includes("TEXT_MESSAGE_CONTENT"));
      assert.equal(events.modelCalls, 1);
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  void test(
    "executes and correlates a real model tool-call round trip",
    async () => {
      const marker = "WINGMAN_TOOL_RESULT_7F3A";
      const calls = [];
      const contexts = [];
      const events = [];
      const tool = {
        name: "lookup_e2e_fixture",
        description: "Return the deterministic value required by the gateway end-to-end test.",

        inputSchema: z.fromJSONSchema({
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
          additionalProperties: false,
        }),
        execute: async (args, execution) => {
          const context = execution?.context;
          calls.push(args);
          contexts.push(context);
          return [{ type: "text", content: marker }];
        },
      };

      const result = await run(
        client,
        selectedModel,
        `You are running an end-to-end tool protocol test. You MUST call lookup_e2e_fixture exactly once with key "wingman". After receiving its result, reply with exactly that result and no other text.`,
        [{ role: Role.User, content: [{ type: "text", text: "Look up the E2E fixture now." }] }],
        [tool],
        { agentName: "gateway-tool-e2e", middleware: [observeRun(events)], agentLoopStrategy: maxIterations(3) },
      );

      assert.equal(result.status, "completed", resultDetail(result));
      assert.deepEqual(calls, [{ key: "wingman" }]);
      assert.equal(contexts[0]?.runId, events.find((event) => event.type === "RUN_STARTED")?.runId);
      assert(contexts[0]?.invocationContext);
      assert.match(messageText(result.messages), new RegExp(marker));

      const toolCall = contentParts(result.messages, "tool_call").find((part) => part.name === tool.name);
      const toolResult = contentParts(result.messages, "tool_result").find((part) => part.name === tool.name);
      assert(toolCall, "The persisted transcript is missing the model tool call");
      assert(toolResult, "The persisted transcript is missing the tool result");
      assert.equal(toolResult.id, toolCall.id);
      assert.deepEqual(
        chunkTypes(events).filter((type) => type === "TOOL_CALL_START" || type === "TOOL_CALL_RESULT"),
        ["TOOL_CALL_START", "TOOL_CALL_RESULT"],
      );
      assert.equal(events.modelCalls, 2);
    },
    { timeout: REQUEST_TIMEOUT_MS * 2 },
  );

  void test(
    "creates and verifies an artifact through Sonnet-compatible production tools",
    async (context) => {
      const artifactModel = process.env.WINGMAN_E2E_ARTIFACT_MODEL ?? "claude-sonnet-4-6";
      if (!availableModels.some((model) => model.id === artifactModel)) {
        context.skip(`${artifactModel} is not exposed by ${GATEWAY_URL}`);
        return;
      }

      // pdfjs touches DOMMatrix at module initialization even though this JSON
      // test never opens a PDF. The browser supplies it in production.
      globalThis.DOMMatrix ??= class DOMMatrix {};
      const fileToolsModule = await harness.vite.ssrLoadModule("/src/shared/lib/file-tools.ts");
      const validatorsModule = await harness.vite.ssrLoadModule("/src/features/artifacts/lib/artifactValidators.ts");
      const verifierModule = await harness.vite.ssrLoadModule("/src/features/artifacts/lib/artifact-verifier.ts");
      const executionSchemasModule = await harness.vite.ssrLoadModule(
        "/src/features/artifacts/lib/executionToolSchemas.ts",
      );
      const questionsToolModule = await harness.vite.ssrLoadModule("/src/features/chat/lib/questionsTool.ts");
      const artifactModule = await harness.vite.ssrLoadModule("/src/shared/types/artifact.ts");
      const toolSchemasModule = await harness.vite.ssrLoadModule("/src/shared/lib/test-support/toolSchemas.ts");

      const files = new Map();
      const source = {
        async list() {
          return [...files.values()].map((file) => ({
            path: file.path,
            size: new TextEncoder().encode(file.content).byteLength,
            contentType: file.contentType,
            revision: file.revision,
          }));
        },
        async read(path) {
          return files.get(path);
        },
        async write(path, content, contentType) {
          const previous = files.get(path);
          const resolvedContentType = contentType ?? (path.endsWith(".json") ? "application/json" : "text/plain");
          const checksum = await artifactModule.artifactChecksum(content, resolvedContentType);
          const revision = `sha256:${checksum}`;
          files.set(path, { path, content, contentType: resolvedContentType, revision });
          return [
            {
              operation: previous ? "update" : "create",
              path,
              contentType: resolvedContentType,
              size: new TextEncoder().encode(content).byteLength,
              checksum,
              revision,
            },
          ];
        },
        async writeBatch(updates) {
          const next = new Map(files);
          const mutations = [];
          for (const { path, content, contentType } of updates) {
            const previous = next.get(path);
            const resolvedContentType = contentType ?? (path.endsWith(".json") ? "application/json" : "text/plain");
            const checksum = await artifactModule.artifactChecksum(content, resolvedContentType);
            const revision = `sha256:${checksum}`;
            next.set(path, { path, content, contentType: resolvedContentType, revision });
            mutations.push({
              operation: previous ? "update" : "create",
              path,
              contentType: resolvedContentType,
              size: new TextEncoder().encode(content).byteLength,
              checksum,
              revision,
            });
          }
          files.clear();
          for (const [path, file] of next) files.set(path, file);
          return mutations;
        },
        async remove(path) {
          return files.delete(path);
        },
        async move(from, to) {
          const file = files.get(from);
          if (!file || files.has(to)) return false;
          files.delete(from);
          files.set(to, { ...file, path: to });
          return true;
        },
      };
      const artifactFs = {
        async listEntries() {
          return [...files.values()];
        },
        async getFile(path) {
          return files.get(path);
        },
      };
      const fileTools = fileToolsModule.createFileTools(source, {
        namespace: "artifacts",
        validators: validatorsModule.ARTIFACT_VALIDATORS,
      });
      const schemaOnlyTools = [
        {
          name: "execute_script",
          description: "Production schema compatibility fixture. Do not call this tool in this test.",
          inputSchema: executionSchemasModule.SCRIPT_EXECUTION_SCHEMA,
        },
      ].map((tool) => ({
        ...tool,
        execute: async () => [{ type: "text", content: "unused" }],
      }));
      const tools = [...fileTools, ...schemaOnlyTools, questionsToolModule.ASK_QUESTIONS_TOOL];

      // Keep the production file, execution, and default question schemas
      // union-free for predictable provider behavior; TanStack controls strictness.
      assert.equal(
        tools.reduce(
          (total, tool) => total + toolSchemasModule.countSchemaUnions(convertSchemaToJsonSchema(tool.inputSchema)),
          0,
        ),
        0,
      );

      const result = await run(
        client,
        artifactModel,
        'Create the requested artifact by calling artifacts_create exactly once with file_path "/result.json" and content "{\\"status\\":\\"ok\\",\\"value\\":42}". Do not call execute_script or ask_questions. After the tool result, reply briefly that the artifact is complete.',
        [{ role: Role.User, content: [{ type: "text", text: "Create the deterministic JSON artifact." }] }],
        tools,
        {
          agentName: "gateway-artifact-e2e",
          agentLoopStrategy: maxIterations(3),
        },
      );

      assert.equal(result.status, "completed", resultDetail(result));
      assert.deepEqual(JSON.parse(files.get("/result.json")?.content ?? "null"), { status: "ok", value: 42 });
      const checks = await verifierModule.verifyArtifacts(artifactFs, ["/result.json"]);
      assert(
        checks.every((check) => check.status === "pass"),
        JSON.stringify(checks),
      );

      const toolResult = contentParts(result.messages, "tool_result").find((part) => part.name === "artifacts_create");
      const delta = artifactModule.artifactDeltaFromMeta(toolResult?.meta);
      assert.equal(delta?.mutations[0]?.operation, "create");
      assert.equal(delta?.mutations[0]?.path, "/result.json");
      assert(delta?.mutations[0]?.revision?.startsWith("sha256:"));
    },
    { timeout: REQUEST_TIMEOUT_MS * 2 },
  );

  void test(
    "cancels an in-flight streamed run and preserves its native partial transcript",
    async () => {
      const controller = new AbortController();
      const prompt = { role: Role.User, content: [{ type: "text", text: "Write several sentences." }] };
      const result = await run(
        client,
        selectedModel,
        "Write a detailed response of at least five sentences.",
        [prompt],
        [],
        {
          agentName: "gateway-cancel-e2e",
          agentLoopStrategy: maxIterations(1),
          options: { signal: controller.signal },
          middleware: [
            {
              onChunk: (_ctx, chunk) => {
                if (chunk.type === "TEXT_MESSAGE_CONTENT") controller.abort("E2E stream cancellation");
              },
            },
          ],
        },
      );

      assert.equal(result.status, "aborted");
      assert.deepEqual(result.messages[0]?.parts, nativeMessage(prompt).parts);
      assert.equal(contentParts(result.messages, "tool_result").length, 0);
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  void test(
    "surfaces a gateway model error as a failed terminal result",
    async () => {
      const result = await run(
        client,
        `wingman-e2e-missing-model-${Date.now()}`,
        "Reply briefly.",
        [{ role: Role.User, content: [{ type: "text", text: "hello" }] }],
        [],
        { agentName: "gateway-error-e2e", agentLoopStrategy: maxIterations(1) },
      );

      assert.equal(result.status, "failed");
      assert(result.error?.code);
      assert(result.error?.message);
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );
});
