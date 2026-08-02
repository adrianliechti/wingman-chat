import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  GATEWAY_URL,
  lifecycleTypes,
  messageText,
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

void describe("Wingman gateway E2E", { concurrency: false }, () => {
  before(
    async () => {
      harness = await startGatewayHarness();
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

  void test(
    "streams a complete agent turn with ordered lifecycle events",
    async () => {
      const events = [];
      const result = await run(
        client,
        selectedModel,
        "This is a transport test. Reply with exactly WINGMAN_E2E_OK and no other text.",
        [{ role: Role.User, content: [{ type: "text", text: "Run the transport test." }] }],
        [],
        { agentName: "gateway-e2e", onEvent: (event) => events.push(event), maxTurns: 1 },
      );

      assert.equal(result.status, "completed", resultDetail(result));
      assert.match(messageText(result.messages), /WINGMAN_E2E_OK/i);
      assert.deepEqual(lifecycleTypes(events), [
        "run.started",
        "model.started",
        "model.streaming",
        "model.completed",
        "run.completed",
      ]);
      assert.deepEqual(
        events.map((event) => event.sequence),
        events.map((_, index) => index),
      );
      assert.equal(result.modelCalls.used, 1);
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
        strict: true,
        parameters: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
          additionalProperties: false,
        },
        function: async (args, context) => {
          calls.push(args);
          contexts.push(context);
          return [{ type: "text", text: marker }];
        },
      };

      const result = await run(
        client,
        selectedModel,
        `You are running an end-to-end tool protocol test. You MUST call lookup_e2e_fixture exactly once with key "wingman". After receiving its result, reply with exactly that result and no other text.`,
        [{ role: Role.User, content: [{ type: "text", text: "Look up the E2E fixture now." }] }],
        [tool],
        { agentName: "gateway-tool-e2e", onEvent: (event) => events.push(event), maxTurns: 3 },
      );

      assert.equal(result.status, "completed", resultDetail(result));
      assert.deepEqual(calls, [{ key: "wingman" }]);
      assert.equal(contexts[0]?.runId, result.runId);
      assert(contexts[0]?.invocationContext);
      assert.match(messageText(result.messages), new RegExp(marker));

      const toolCall = result.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === "tool_call" && part.name === tool.name);
      const toolResult = result.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === "tool_result" && part.name === tool.name);
      assert(toolCall, "The persisted transcript is missing the model tool call");
      assert(toolResult, "The persisted transcript is missing the tool result");
      assert.equal(toolResult.id, toolCall.id);
      assert.deepEqual(
        lifecycleTypes(events).filter((type) => type.startsWith("tool.")),
        ["tool.started", "tool.completed"],
      );
      assert.equal(result.modelCalls.used, 2);
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
      const declarationSchemaModule = await harness.vite.ssrLoadModule(
        "/src/features/studio/lib/artifactDeclarationSchema.ts",
      );
      const artifactModule = await harness.vite.ssrLoadModule("/src/shared/types/artifact.ts");
      const toolSchemasModule = await harness.vite.ssrLoadModule("/src/shared/lib/toolSchemas.ts");

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
        async listFiles() {
          return [...files.values()].map(({ path, content, contentType }) => ({ path, content, contentType }));
        },
      };
      const fileTools = fileToolsModule.createFileTools(source, {
        validators: validatorsModule.ARTIFACT_VALIDATORS,
      });
      const schemaOnlyTools = [
        {
          name: "execute_python_code",
          description: "Production schema compatibility fixture. Do not call this tool in this test.",
          strict: false,
          parameters: executionSchemasModule.PYTHON_EXECUTION_PARAMETERS,
        },
        {
          name: "execute_javascript_code",
          description: "Production schema compatibility fixture. Do not call this tool in this test.",
          strict: false,
          parameters: executionSchemasModule.JAVASCRIPT_EXECUTION_PARAMETERS,
        },
        {
          name: "declare_artifact",
          description: "Production schema compatibility fixture. Do not call this tool in this test.",
          strict: false,
          parameters: declarationSchemaModule.ARTIFACT_DECLARATION_PARAMETERS,
        },
      ].map((tool) => ({
        ...tool,
        function: async () => [{ type: "text", text: "unused" }],
      }));
      const tools = [...fileTools, ...schemaOnlyTools];

      // These are the exact production file, Studio declaration, and execution
      // schemas that previously totaled 22 nullable unions. Keep the full set
      // union-free and schema-guided for predictable provider behavior.
      assert.equal(
        tools.reduce((total, tool) => total + toolSchemasModule.countSchemaUnions(tool.parameters), 0),
        0,
      );
      assert.deepEqual(tools.filter((tool) => tool.strict).map((tool) => tool.name), []);

      let manifest;
      const result = await run(
        client,
        artifactModel,
        'Create the requested artifact by calling create_file exactly once with path "/result.json" and content "{\\"status\\":\\"ok\\",\\"value\\":42}". Do not call execute_python_code, execute_javascript_code, or declare_artifact. After the tool result, reply briefly that the artifact is complete.',
        [{ role: Role.User, content: [{ type: "text", text: "Create the deterministic JSON artifact." }] }],
        tools,
        {
          agentName: "gateway-artifact-e2e",
          maxTurns: 3,
          beforeFinish: async ({ runId }) => {
            const now = new Date().toISOString();
            const job = artifactModule.ArtifactJobSchema.parse({
              id: "gateway-artifact-job",
              chatId: "gateway-artifact-chat",
              runId,
              kind: "data",
              primaryPath: "/result.json",
              phase: "validating",
              sourceRefs: [],
              createdAt: now,
              updatedAt: now,
            });
            manifest = await verifierModule.verifyArtifactJob(artifactFs, job);
            const primary = manifest.files.find((file) => file.path === manifest.primaryPath);
            return {
              action: "finish",
              appendContent: primary
                ? [
                    {
                      type: "artifact_ref",
                      jobId: job.id,
                      path: primary.path,
                      revision: primary.revision,
                      displayName: "result.json",
                    },
                  ]
                : [],
            };
          },
        },
      );

      assert.equal(result.status, "completed", resultDetail(result));
      assert.deepEqual(JSON.parse(files.get("/result.json")?.content ?? "null"), { status: "ok", value: 42 });
      assert.equal(manifest?.verification.status, "clean", JSON.stringify(manifest?.verification));
      assert.equal(manifest?.files[0]?.role, "primary");

      const toolResult = result.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === "tool_result" && part.name === "create_file");
      const delta = artifactModule.artifactDeltaFromMeta(toolResult?.meta);
      assert.equal(delta?.mutations[0]?.operation, "create");
      assert.equal(delta?.mutations[0]?.path, "/result.json");
      assert(delta?.mutations[0]?.revision?.startsWith("sha256:"));

      const artifactRef = result.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === "artifact_ref");
      assert.equal(artifactRef?.path, "/result.json");
      assert.equal(artifactRef?.revision, delta?.mutations[0]?.revision);
    },
    { timeout: REQUEST_TIMEOUT_MS * 2 },
  );

  void test(
    "cancels an in-flight streamed run without committing a partial assistant turn",
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
          maxTurns: 1,
          options: { signal: controller.signal },
          onStream: () => controller.abort("E2E stream cancellation"),
        },
      );

      assert.equal(result.status, "aborted");
      assert.equal(result.stopReason, "abort");
      assert.deepEqual(result.messages, [prompt]);
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
        { agentName: "gateway-error-e2e", maxTurns: 1 },
      );

      assert.equal(result.status, "failed");
      assert.equal(result.stopReason, "error");
      assert(result.error?.code);
      assert(result.error?.message);
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );
});
