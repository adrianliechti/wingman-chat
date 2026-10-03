import { toolCallMessage } from "@/shared/lib/test-support/ai";
import { maxIterations } from "@tanstack/ai";
import { beforeEach, expect, it, vi } from "vitest";
import { RunSidecar, streamRun, type AgentRunResult, type RunHooks } from "@/shared/lib/agent";
import { assistantMessage, userMessage } from "@/shared/lib/messages";
import { testClient } from "@/shared/lib/test-support/ai";
import type { ArtifactMutation } from "@/shared/types/artifact";
import type { UIMessage } from "@tanstack/ai";
import type { Tool } from "@/shared/types/chat";
import { artifactVerification } from "./artifactVerification";
import { verifyArtifacts } from "./artifact-verifier";
import type { FileSystemManager } from "./fs";

vi.mock("./artifact-verifier", () => ({ verifyArtifacts: vi.fn() }));
const verify = vi.mocked(verifyArtifacts);
const fs = { chatId: "chat" } as FileSystemManager;
const prompt = userMessage("Build a game", { id: "prompt" });
const done = assistantMessage("Finished");
const call = (id: string) => toolCallMessage([{ id, name: "write", arguments: "{}" }]);
const write = (...batches: ArtifactMutation[][]): Tool => ({
  name: "write",
  parameters: { type: "object", properties: {} },
  function: async (_args, ctx) => {
    ctx?.setMeta?.({ artifactDelta: { mutations: batches.shift() ?? [] } });
    return [{ type: "text", content: "Saved" }];
  },
});
/** A completed write in saved history: the call and its result in one assistant turn. */
const saved = (id: string, ...mutations: ArtifactMutation[]): UIMessage => ({
  ...call(id),
  id: `turn-${id}`,
  parts: [
    { type: "tool-call", id, name: "write", arguments: "{}", state: "complete" },
    {
      type: "tool-result",
      toolCallId: id,
      content: "Saved",
      state: "complete",
      metadata: { result: [{ type: "text", content: "Saved" }], meta: { artifactDelta: { mutations } } },
    },
  ],
});

async function execute(
  complete: Parameters<typeof testClient>[0],
  tools: Tool[] = [],
  messages: UIMessage[] = [prompt],
  hooks: RunHooks = {},
) {
  const sidecar = new RunSidecar();
  let result!: AgentRunResult;
  const chunks = [];
  for await (const chunk of streamRun(testClient(complete), "model", "", messages, tools, {
    ...hooks,
    sidecar,
    middleware: [artifactVerification(fs, sidecar, messages)],
    onComplete: (value) => {
      result = value;
    },
  }))
    chunks.push(chunk);
  return { result, chunks };
}

beforeEach(() => {
  verify.mockReset().mockResolvedValue([]);
});

it("repairs in one native cycle and replaces findings after a dependency is written", async () => {
  const checked: string[][] = [];
  verify.mockImplementation(async (_fs, paths) => {
    checked.push([...paths]);
    return checked.length === 1
      ? [{ id: "html.local-ref", scope: "/game.html", status: "fail", message: "Missing /game.js" }]
      : [];
  });
  const complete = vi
    .fn()
    .mockResolvedValueOnce(call("html"))
    .mockResolvedValueOnce(call("js"))
    .mockResolvedValue(done);
  const { result, chunks } = await execute(complete, [
    write([{ operation: "create", path: "/game.html" }], [{ operation: "create", path: "/game.js" }]),
  ]);
  expect(result.status).toBe("completed");
  expect(complete).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain("Missing /game.js");
  expect(JSON.stringify(complete.mock.calls[2][0].messages)).toContain("Workspace verification passed");
  expect(JSON.stringify(complete.mock.calls[2][0].messages)).not.toContain("Missing /game.js");
  expect(JSON.stringify(result.messages)).not.toContain("Workspace verification");
  expect(chunks.filter((chunk) => chunk.type === "RUN_FINISHED")).toHaveLength(1);
  expect(checked).toEqual([["/game.html"], ["/game.html", "/game.js"]]);
});

it("restores only current-turn writes, honoring directory moves and deletions", async () => {
  const messages = [
    prompt,
    saved("old", { operation: "create", path: "/old.html" }),
    done,
    userMessage("Build a game", { id: "prompt-2" }),
    saved("create", { operation: "create", path: "/draft/game.html" }, { operation: "create", path: "/tmp/a.txt" }),
    saved("move", { operation: "move", from: "/draft/game.html", path: "/game.html" }),
    saved("delete", { operation: "delete", path: "/tmp" }),
  ];
  await execute(vi.fn().mockResolvedValue(done), [], JSON.parse(JSON.stringify(messages)));
  expect(verify).toHaveBeenCalledOnce();
  expect([...verify.mock.calls[0][1]]).toEqual(["/game.html"]);
});

it("does not verify a conversation or tool that made no workspace changes", async () => {
  const complete = vi.fn().mockResolvedValueOnce(call("read")).mockResolvedValue(done);
  await execute(complete, [write()]);
  expect(verify).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledTimes(2);
});

it("clears findings after the generated file is deleted", async () => {
  verify.mockResolvedValue([{ id: "syntax.json", scope: "/bad.json", status: "fail", message: "Invalid JSON" }]);
  const complete = vi
    .fn()
    .mockResolvedValueOnce(call("create"))
    .mockResolvedValueOnce(call("delete"))
    .mockResolvedValue(done);
  await execute(complete, [
    write([{ operation: "create", path: "/bad.json" }], [{ operation: "delete", path: "/bad.json" }]),
  ]);
  expect(verify).toHaveBeenCalledOnce();
  expect(JSON.stringify(complete.mock.calls[2][0].messages)).not.toContain("Invalid JSON");
});

it("keeps the native iteration limit even if every verification fails", async () => {
  verify.mockResolvedValue([{ id: "html.local-ref", scope: "/game.html", status: "fail", message: "Missing script" }]);
  const complete = vi.fn().mockResolvedValue(call("write"));
  const { result } = await execute(complete, [write([{ operation: "create", path: "/game.html" }])], [prompt], {
    agentLoopStrategy: maxIterations(2),
  });
  expect(result.status).toBe("completed");
  expect(complete).toHaveBeenCalledTimes(2);
});

it("reports unavailable verification to the model without discarding saved work", async () => {
  verify.mockRejectedValue(new Error("Workspace unavailable"));
  const complete = vi.fn().mockResolvedValueOnce(call("write")).mockResolvedValue(done);
  const { result } = await execute(complete, [write([{ operation: "create", path: "/game.html" }])]);
  expect(result.status).toBe("completed");
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain("Workspace unavailable");
  expect(JSON.stringify(result.messages)).toContain("/game.html");
});

it("does not start another model turn when stopped during verification", async () => {
  const controller = new AbortController();
  let release!: () => void;
  verify.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
  );
  const complete = vi.fn().mockResolvedValueOnce(call("write")).mockResolvedValue(done);
  const running = execute(complete, [write([{ operation: "create", path: "/game.html" }])], [prompt], {
    options: { signal: controller.signal },
  });
  await expect.poll(() => verify.mock.calls.length).toBe(1);
  controller.abort();
  release();
  expect((await running).result.status).toBe("aborted");
  expect(complete).toHaveBeenCalledOnce();
});
