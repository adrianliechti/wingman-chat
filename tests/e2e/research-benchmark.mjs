import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { maxIterations } from "@tanstack/ai";
import { lastAssistantText, startGatewayHarness } from "./gateway-harness.mjs";
import { fixtureClient, researchCases } from "./fixtures/research-cases.mjs";
import { webCases } from "./fixtures/research-web-cases.mjs";
import { gradeResearchAnswer, normalize } from "./research-grading.mjs";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "replay" },
    variant: { type: "string", default: "both" },
    model: { type: "string", default: "gpt-5.4-mini" },
    repeats: { type: "string", default: "1" },
    cases: { type: "string" },
    dataset: { type: "string" },
    searcher: { type: "string", default: "web" },
    scraper: { type: "string", default: "web" },
    output: { type: "string", default: "test-results/research-benchmark.json" },
  },
});
assert(["replay", "model", "web"].includes(values.mode), "--mode must be replay, model or web");
assert(["baseline", "current", "both"].includes(values.variant), "Invalid --variant");
const repeats = Number(values.repeats);
assert(Number.isInteger(repeats) && repeats > 0 && repeats <= 20, "--repeats must be 1..20");
const dataset = values.dataset
  ? JSON.parse(await readFile(values.dataset, "utf8"))
  : values.mode === "web"
    ? webCases
    : researchCases;
assert(
  Array.isArray(dataset) &&
    dataset.every(
      (item) => typeof item.id === "string" && typeof item.question === "string" && Array.isArray(item.expected),
    ),
  "Dataset must contain id, question and expected for each case",
);
const cases = values.cases ? dataset.filter(({ id }) => values.cases.split(",").includes(id)) : dataset;
assert(cases.length > 0, "No matching cases");

const rows = [];
let harness;
let vite;
try {
  if (values.mode !== "replay") {
    harness = await startGatewayHarness();
    vite = harness.vite;
    assert(
      harness.availableModels.some(({ id }) => id === values.model),
      "Requested model unavailable",
    );
  } else {
    vite = await createServer({ logLevel: "error", server: { middlewareMode: true, hmr: false, ws: false } });
  }
  const baseline = await vite.ssrLoadModule("/tests/e2e/fixtures/research-baseline.ts");
  const { createInternetProvider } = await vite.ssrLoadModule("/src/features/research/hooks/useInternetProvider.ts");
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const fixture of cases) {
      // Alternate order to reduce systematic cache/warmup effects in live runs.
      const variants =
        values.variant === "both" ? (repeat % 2 ? ["current", "baseline"] : ["baseline", "current"]) : [values.variant];
      for (const variant of variants) {
        const metrics = {
          toolCalls: 0,
          toolErrors: 0,
          searchRequests: 0,
          fetchRequests: 0,
          resultChars: 0,
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
        };
        const client =
          values.mode === "web"
            ? {
                async search(_model, query, options, requestOptions) {
                  metrics.searchRequests++;
                  return harness.client.search(values.searcher, query, options, requestOptions);
                },
                async scrape(_model, url, requestOptions) {
                  metrics.fetchRequests++;
                  return harness.client.scrape(values.scraper, url, requestOptions);
                },
              }
            : fixtureClient(fixture, metrics);
        const spec =
          variant === "baseline"
            ? {
                tools: baseline.buildWebTools(client, { searcher: "fixture", scraper: "fixture" }),
                instructions: baseline.instructions,
              }
            : createInternetProvider(client, { searcher: "fixture", scraper: "fixture" }).tools[0].subagent;
        const trace = [];
        const tools = spec.tools.map((tool) => ({
          ...tool,
          execute: async (args, execution) => {
            metrics.toolCalls++;
            let result;
            try {
              result = await tool.execute(args, execution);
            } catch (error) {
              metrics.toolErrors++;
              trace.push({ name: tool.name, args, error: error instanceof Error ? error.message : String(error) });
              throw error;
            }
            const text = result
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
            metrics.resultChars += text.length;
            trace.push({ name: tool.name, args, text });
            return result;
          },
        }));
        const start = performance.now();
        let result;
        let answer;
        let error;
        try {
          if (values.mode === "replay") {
            const signal = new AbortController().signal;
            for (const call of fixture.calls)
              await tools
                .find(({ name }) => name === call.name)
                .execute(call.args, { context: { signal }, emitCustomEvent() {} });
          } else {
            result = await harness.run(
              harness.client,
              values.model,
              spec.instructions,
              [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `${fixture.question}\nUse the web tools for evidence. Return only JSON: {"items":[{"answer":"concise answer item","sources":["supporting URL"]}]}. Use an empty items array if the evidence is insufficient.`,
                    },
                  ],
                },
              ],
              tools,
              {
                agentLoopStrategy: maxIterations(10),
                options: { effort: "low", maxOutputTokens: 2048, signal: AbortSignal.timeout(120_000) },
                middleware: [
                  {
                    name: "benchmark-metrics",
                    onIteration() {
                      metrics.modelCalls++;
                    },
                    onUsage(_ctx, usage) {
                      metrics.inputTokens += usage.promptTokens ?? 0;
                      metrics.outputTokens += usage.completionTokens ?? 0;
                      metrics.cachedInputTokens += usage.promptTokensDetails?.cachedTokens ?? 0;
                    },
                  },
                ],
              },
            );
            answer = lastAssistantText(result.messages);
          }
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
        }
        const observed = trace.map(({ text }) => text).join("\n");
        const literalEvidenceRecall = fixture.expected.length
          ? fixture.expected.filter(({ answer }) => normalize(observed).includes(normalize(answer))).length /
            fixture.expected.length
          : null;
        const row = {
          case: fixture.id,
          variant,
          repeat,
          ...metrics,
          elapsedMs: Math.round(performance.now() - start),
          literalEvidenceRecall,
          ...(values.mode !== "replay"
            ? gradeResearchAnswer(
                !error && result?.status === "completed" ? (answer ?? "") : "",
                fixture.expected,
                observed,
              )
            : {}),
          status: error ? "failed" : (result?.status ?? "completed"),
          error: error ?? result?.error?.message,
          reachedTurnLimit: metrics.modelCalls >= 10,
          answer,
          trace,
        };
        rows.push(row);
        console.log(JSON.stringify({ ...row, trace: undefined, answer: undefined }));
      }
    }
  }
  const summary = [...new Set(rows.map(({ variant }) => variant))].map((variant) => {
    const selected = rows.filter((row) => row.variant === variant);
    const sum = (key) => selected.reduce((total, row) => total + (row[key] ?? 0), 0);
    return {
      variant,
      cases: selected.length,
      toolCalls: sum("toolCalls"),
      toolErrors: sum("toolErrors"),
      runsAtTurnLimit: selected.filter((row) => row.reachedTurnLimit).length,
      networkRequests: sum("searchRequests") + sum("fetchRequests"),
      resultChars: sum("resultChars"),
      modelCalls: sum("modelCalls"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cachedInputTokens: sum("cachedInputTokens"),
      elapsedMs: sum("elapsedMs"),
      literalEvidenceRecall:
        sum("literalEvidenceRecall") / selected.filter((row) => row.literalEvidenceRecall !== null).length,
      ...(values.mode !== "replay"
        ? { answerF1: sum("answerF1") / selected.length, citationRecall: sum("citationRecall") / selected.length }
        : {}),
    };
  });
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(
    values.output,
    JSON.stringify(
      {
        mode: values.mode,
        model: values.mode !== "replay" ? values.model : null,
        baseline: "fa3d5e82",
        timestamp: new Date().toISOString(),
        settings: { effort: "low", maxIterations: 10, maxOutputTokens: 2048, timeoutMs: 120000 },
        repeats,
        summary,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.table(summary);
  console.log(
    `Saved ${values.output}. ${values.mode === "replay" ? "Scripted tool replay; no model quality or latency claims." : values.mode === "web" ? "Live model and web retrieval; a smoke set, not a public benchmark score." : "Real model, fixed synthetic retrieval; not a live-web or public benchmark score."}`,
  );
  if (rows.some(({ status }) => status !== "completed")) process.exitCode = 1;
} finally {
  if (harness) await harness.close();
  else await vite?.close();
}
