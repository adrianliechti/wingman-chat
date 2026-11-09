import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import OpenAI from "openai";
import { z } from "zod";
import { contentParts, resultDetail, startGatewayHarness, user } from "./gateway-harness.mjs";

// Compare the app and official SDK against identical live gateway responses.
// Separate generations cannot establish exact text/signature/usage parity.
const models = (process.env.WINGMAN_SDK_MODELS ?? "gpt-6-luna,claude-sonnet-5-5,gemini-4-argon").split(",");
let harness;

void describe("live gateway / OpenAI SDK parity", { concurrency: false }, () => {
  before(async () => {
    harness = await startGatewayHarness();
    for (const model of models)
      assert(
        harness.availableModels.some((item) => item.id === model),
        `Missing requested model: ${model}`,
      );
  });
  after(async () => harness?.close());

  for (const model of models) {
    void test(
      `${model}: answers, phases, reasoning, tools, usage, and persisted replay`,
      { timeout: 240_000 },
      async () => {
        const originalFetch = globalThis.fetch;
        const recordings = [];
        globalThis.fetch = async (input, init) => {
          const response = await originalFetch(input, init);
          const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
          if (url.includes("/responses") && response.ok)
            recordings.push(
              response
                .clone()
                .text()
                .then((body) => ({ body, headers: response.headers })),
            );
          return response;
        };
        let result;
        let replay;
        let firstCount;
        let executions = 0;
        try {
          result = await harness.run(
            harness.client,
            model,
            "Call lookup exactly once with code ORCHID-731. Then reply with its returned code, without other text.",
            [user("Look up the code now.")],
            [
              {
                name: "lookup",
                description: "Look up a code",
                inputSchema: z.object({ code: z.string() }),
                execute: async ({ code }) => {
                  executions++;
                  assert.equal(code, "ORCHID-731");
                  return [{ type: "text", content: "ORCHID-731" }];
                },
              },
            ],
            { options: { effort: "low", signal: AbortSignal.timeout(120_000) } },
          );
          assert.equal(result.status, "completed", resultDetail(result));
          assert.equal(executions, 1, "tool executed more than once");
          firstCount = recordings.length;
          replay = await harness.run(
            harness.client,
            model,
            "Reply only with the code from the earlier tool result.",
            [...JSON.parse(JSON.stringify(result.messages)), user("Repeat the code.")],
            [],
            { options: { effort: "low", signal: AbortSignal.timeout(120_000) } },
          );
          assert.equal(replay.status, "completed", resultDetail(replay));
        } finally {
          globalThis.fetch = originalFetch;
        }
        const captured = await Promise.all(recordings);
        assert(firstCount >= 2, "missing tool round trip");
        assert.equal(captured.length, firstCount + 1, "persisted replay unexpectedly retried");
        const sdkResponses = [];
        for (const recording of captured) {
          const sdk = new OpenAI({
            apiKey: "recorded-response",
            maxRetries: 0,
            fetch: async () => new Response(recording.body, { headers: recording.headers }),
          });
          const stream = await sdk.responses.create({ model, input: "recorded request", stream: true });
          let completed;
          for await (const event of stream) {
            assert.notEqual(event.type, "error", JSON.stringify(event));
            if (event.type === "response.completed") completed = event.response;
          }
          assert(completed, "official SDK did not receive a completed response");
          assert.equal(completed.status, "completed");
          sdkResponses.push(completed);
        }
        compareMessages(
          result.messages.filter((item) => item.role === "assistant"),
          sdkResponses.slice(0, firstCount),
        );
        compareMessages(
          replay.messages.slice(result.messages.length).filter((item) => item.role === "assistant"),
          sdkResponses.slice(firstCount),
        );
        assert.match(
          replay.messages
            .at(-1)
            .parts.filter((part) => part.type === "text")
            .map((part) => part.content)
            .join(""),
          /ORCHID-731/,
        );
      },
    );
  }
});

function compareMessages(messages, responses) {
  const output = responses.flatMap((response) => response.output);
  assert.deepEqual(
    messages.flatMap((message) =>
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => ({
          text: part.content,
          phase: part.metadata?.phase,
        })),
    ),
    output
      .filter((item) => item.type === "message")
      .map((item) => ({
        text: item.content
          .filter((part) => part.type === "output_text")
          .map((part) => part.text)
          .join(""),
        phase: item.phase ?? undefined,
      })),
  );
  assert.deepEqual(
    contentParts(messages, "tool_call").map((call) => ({
      id: call.id,
      name: call.name,
      arguments: JSON.parse(call.arguments),
    })),
    output
      .filter((item) => item.type === "function_call")
      .map((call) => ({ id: call.call_id, name: call.name, arguments: JSON.parse(call.arguments) })),
  );
  const reasoning = contentParts(messages, "reasoning");
  for (const item of output.filter((item) => item.type === "reasoning")) {
    const actual = reasoning.find((part) => part.id === item.id);
    assert(actual, `Missing reasoning item ${item.id}`);
    assert.equal(actual.encryptedContent, item.encrypted_content ?? undefined);
    assert.equal(actual.text ?? "", (item.content ?? []).map((part) => part.text ?? "").join(""));
    assert.equal(actual.summary ?? "", (item.summary ?? []).map((part) => part.text ?? "").join(""));
  }
  assert.equal(reasoning.length, output.filter((item) => item.type === "reasoning").length);
  assert.deepEqual(
    messages
      .filter((message) => message.metadata?.usage)
      .map((message) => message.metadata.usage)
      .map((usage) => ({
        model: usage.model,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cached: usage.cachedInputTokens ?? 0,
        reasoning: usage.reasoningTokens ?? 0,
      })),
    responses.map((response) => ({
      model: response.model,
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cached: response.usage.input_tokens_details?.cached_tokens ?? 0,
      reasoning: response.usage.output_tokens_details?.reasoning_tokens ?? 0,
    })),
  );
}
