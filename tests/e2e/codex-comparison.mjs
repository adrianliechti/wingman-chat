import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createArtifactWorkspace } from "./artifact-workspace.mjs";
import { startGatewayHarness, assertModelsAvailable, lastAssistantText } from "./gateway-harness.mjs";
import { evaluateFiles, initialFiles, task } from "./file-edit-scenario.mjs";

const execFileAsync = promisify(execFile);
const model = process.env.WINGMAN_COMPARE_MODEL ?? "gpt-5.4";
const codex = process.env.WINGMAN_COMPARE_CODEX ?? "codex";
const timeout = 240_000;
const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "wingman-codex-comparison-"));
console.log(`Comparison outputs: ${outputDir}`);
let harness;
let wingman;
let official;
const report = { scenario: "returns-policy-rollout", model, outputDir, results: {} };

async function snapshot(workspace) {
  return Object.fromEntries(
    await Promise.all((await workspace.list()).map(async ({ path }) => [path, (await workspace.read(path)).content])),
  );
}

try {
  harness = await startGatewayHarness();
  assertModelsAvailable(harness.availableModels, [model]);
  const artifactModule = await harness.vite.ssrLoadModule("/src/shared/types/artifact.ts");
  const fileToolsModule = await harness.vite.ssrLoadModule("/src/shared/lib/file-tools.ts");
  wingman = await createArtifactWorkspace(artifactModule, initialFiles);
  official = await createArtifactWorkspace(artifactModule, initialFiles);
  const tools = fileToolsModule.createFileTools(wingman.source, {
    namespace: "artifacts",
    spaceName: "artifact workspace",
  });
  const instructions = (
    await Promise.all(
      ["src/features/chat/prompts/default.txt", "src/features/artifacts/prompts/artifacts.txt"].map((file) =>
        fs.readFile(file, "utf8"),
      ),
    )
  ).join("\n\n");

  console.log(`Running Wingman file tools with ${model}...`);
  const start = performance.now();
  const result = await harness.run(
    harness.client,
    model,
    instructions,
    [{ role: "user", content: [{ type: "text", text: task }] }],
    tools,
    {
      agentName: "file-edit-comparison",
      maxTurns: 20,
      options: { signal: AbortSignal.timeout(timeout), effort: "medium" },
    },
  );
  const files = await snapshot(wingman);
  const parts = result.messages.flatMap((message) => message.content);
  report.results.wingman = {
    status: result.status,
    elapsedMs: Math.round(performance.now() - start),
    modelCalls: result.modelCalls.used,
    toolCalls: parts.filter((part) => part.type === "tool_call").map((part) => part.name),
    usage: result.messages.reduce(
      (total, message) => {
        for (const key of ["inputTokens", "cachedInputTokens", "outputTokens"]) total[key] += message.usage?.[key] ?? 0;
        return total;
      },
      { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    ),
    evaluation: evaluateFiles(files),
    final: lastAssistantText(result.messages),
  };
  await fs.writeFile(path.join(outputDir, "wingman.json"), JSON.stringify({ result, files }, null, 2));
  console.log(JSON.stringify(report.results.wingman));

  console.log(`Running official Codex CLI with ${model}...`);
  report.codexVersion = (await execFileAsync(codex, ["--version"])).stdout.trim();
  const codexStart = performance.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const execution = execFileAsync(
      codex,
      [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "--cd",
        official.root,
        "--model",
        model,
        "-c",
        'model_reasoning_effort="medium"',
        task,
      ],
      { timeout, maxBuffer: 8 * 1024 * 1024 },
    );
    // Codex accepts prompt-plus-stdin. An unused pipe must still receive EOF.
    execution.child.stdin?.end();
    const output = await execution;
    stdout = output.stdout;
    stderr = output.stderr;
  } catch (error) {
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? String(error);
    exitCode = error.code ?? 1;
  }
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const officialFiles = await snapshot(official);
  report.results.codex = {
    exitCode,
    status: events.some((event) => event.type === "turn.completed") ? "completed" : "incomplete",
    elapsedMs: Math.round(performance.now() - codexStart),
    actions: events.filter((event) => event.type === "item.completed").map((event) => event.item?.type),
    usage: events.findLast((event) => event.type === "turn.completed")?.usage,
    evaluation: evaluateFiles(officialFiles),
    final: events.findLast((event) => event.type === "item.completed" && event.item?.type === "agent_message")?.item
      ?.text,
    errors: events.filter((event) => event.type === "error" || event.type === "turn.failed"),
  };
  await fs.writeFile(
    path.join(outputDir, "codex.json"),
    JSON.stringify({ events, stderr, files: officialFiles }, null, 2),
  );
  console.log(JSON.stringify(report.results.codex));
} finally {
  await fs.writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  await harness?.close();
  await wingman?.cleanup();
  await official?.cleanup();
}
if (
  Object.keys(report.results).length !== 2 ||
  Object.values(report.results).some(
    (result) =>
      result.status !== "completed" ||
      (result.exitCode !== undefined && result.exitCode !== 0) ||
      result.evaluation.passed !== result.evaluation.total,
  )
)
  process.exitCode = 1;
