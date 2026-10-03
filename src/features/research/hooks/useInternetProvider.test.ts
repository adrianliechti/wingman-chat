import { convertSchemaToJsonSchema } from "@tanstack/ai";
import { toolCallMessage } from "@/shared/lib/test-support/ai";
import { expect, it, vi } from "vitest";
import { run } from "@/shared/lib/agent";
import { testClient } from "@/shared/lib/test-support/ai";
import { chatSession, boundInterrupt } from "@/shared/lib/test-support/chatSession";
import type { Client } from "@/shared/lib/client";
import { assistantMessage, userMessage } from "@/shared/lib/messages";
import { createInternetProvider } from "./useInternetProvider";

const answer = (text: string) => assistantMessage(text);
const call = (name: string, args: object) => toolCallMessage([{ id: name, name, arguments: JSON.stringify(args) }]);
const brief = "Find sources about the requested topic";
function fixture(elicitation = false, researchModel?: string) {
  const complete = vi.fn<Parameters<typeof testClient>[0]>();
  const client = Object.assign(testClient(complete), {
    guard: vi.fn<Client["guard"]>().mockResolvedValue({ flagged: false, categories: [] }),
    search: vi
      .fn<Client["search"]>()
      .mockResolvedValue([{ title: "Source", source: "https://example.com", content: "Evidence" }]),
    scrape: vi.fn<Client["scrape"]>().mockResolvedValue("Fetched evidence"),
  });
  const provider = createInternetProvider(client, {
    searcher: "search",
    scraper: "scrape",
    guard: "guard",
    elicitation,
    model: researchModel,
  })!;
  return { complete, client, tools: provider.tools };
}

it("streams research as a native child with a self-contained brief and child cancellation", async () => {
  const { client, complete, tools } = fixture();
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: brief, mode: "deep" }))
    .mockResolvedValueOnce(call("web_search", { queries: ["topic"], domains: ["example.com"] }))
    .mockResolvedValueOnce(call("web_fetch", { urls: ["https://example.com"] }))
    .mockResolvedValueOnce(answer("Report with sources"))
    .mockResolvedValueOnce(answer("Parent answer"));
  const result = await run(client, "parent-model", "", [userMessage("Unrelated parent details")], tools);
  expect(result.status).toBe("completed");
  expect(client.guard).toHaveBeenCalledOnce();
  expect(client.guard.mock.calls[0][1]).toContain(brief);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain(brief);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).not.toContain("Unrelated parent details");
  expect(complete.mock.calls[1][0].model).toBe("parent-model");
  const signal = client.search.mock.calls[0][3]?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(client.search).toHaveBeenCalledWith("search", "topic", { domains: ["example.com"], limit: 8 }, { signal });
  expect(client.scrape).toHaveBeenCalledWith("scrape", "https://example.com", { signal });
  const child = result.messages.flatMap((message) => message.parts).find((part) => part.type === "subagent");
  expect(child?.subagent.status).toBe("finished");
  expect(JSON.stringify(child)).toContain("web_search");
  expect(JSON.stringify(child)).toContain("Fetched evidence");
  expect(JSON.stringify(complete.mock.calls.at(-1)?.[0].messages)).toContain("Report with sources");
});

it("allows fast search to finish after a slow guard check within the task deadline", async () => {
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Deadline expired", "TimeoutError")), ms);
    return controller.signal;
  });
  try {
    const { client, complete, tools } = fixture();
    client.guard.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 16_000));
      return { flagged: false, categories: [] };
    });
    complete
      .mockResolvedValueOnce(call("web_research", { prompt: brief, mode: "fast" }))
      .mockResolvedValueOnce(answer("Parent answer"));
    const task = run(client, "model", "", [userMessage("Research")], tools);
    await vi.advanceTimersByTimeAsync(16_000);
    const result = await task;
    expect(client.search).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.messages)).toContain("Evidence");
    expect(complete).toHaveBeenCalledTimes(2);
  } finally {
    timeout.mockRestore();
    vi.useRealTimers();
  }
});

it("uses the configured deep-research model while the parent retains its model", async () => {
  const { client, complete, tools } = fixture(false, "cheaper-research-model");
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: brief, mode: "deep" }))
    .mockResolvedValueOnce(answer("Findings"))
    .mockResolvedValueOnce(answer("Parent answer"));
  await run(client, "parent-model", "", [userMessage("Research")], tools);
  expect(complete.mock.calls.map(([request]) => request.model)).toEqual([
    "parent-model",
    "cheaper-research-model",
    "parent-model",
  ]);
});

it.each([true, false])("restores research approval before starting the child (approved=%s)", async (approved) => {
  const { client, complete, tools } = fixture(true);
  complete.mockResolvedValueOnce(call("web_research", { prompt: brief, mode: "deep" }));
  if (approved) complete.mockResolvedValueOnce(answer("Research report"));
  complete.mockResolvedValueOnce(answer("Done"));
  const original = chatSession(client, tools);
  await original.ai.sendMessage("Research this");
  expect(complete).toHaveBeenCalledOnce();
  expect(client.guard).not.toHaveBeenCalled();
  expect(client.search).not.toHaveBeenCalled();
  await expect.poll(() => original.store.value?.resume?.pendingInterrupts?.length).toBe(1);
  original.ai.dispose();
  const restored = chatSession(client, tools, original.store);
  await expect.poll(() => restored.ai.getInterruptState().interrupts.length).toBe(1);
  const approval = boundInterrupt(restored.ai.getInterruptState().interrupts[0]);
  expect(approval.kind).toBe("tool-approval");
  approval.resolveInterrupt(approved);
  await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
  expect(client.guard).toHaveBeenCalledTimes(approved ? 1 : 0);
  expect(complete).toHaveBeenCalledTimes(approved ? 3 : 2);
  restored.ai.dispose();
});

it.each(["flagged", "unavailable"])("does not start a research request when the guard is %s", async (failure) => {
  const { client, complete, tools } = fixture();
  if (failure === "flagged")
    client.guard.mockResolvedValue({ flagged: true, categories: [{ name: "blocked", score: 1 }] });
  else client.guard.mockRejectedValue(new Error("offline"));
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: brief, mode: "deep" }))
    .mockResolvedValueOnce(answer("Cannot research"));
  const result = await run(client, "model", "", [userMessage("Research")], tools);
  expect(result.status).toBe("completed");
  expect(complete).toHaveBeenCalledTimes(2);
  expect(client.search).not.toHaveBeenCalled();
  expect(client.scrape).not.toHaveBeenCalled();
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain(
    failure === "flagged" ? "Request blocked" : "not available",
  );
});

it("keeps live confirmation for realtime and never silently skips a required confirmation", async () => {
  const { client, complete, tools } = fixture(true);
  const tool = tools[0];
  expect(
    await tool.execute({ prompt: brief, mode: "deep" }, { context: { model: "model" }, emitCustomEvent() {} }),
  ).toEqual([{ type: "text", content: expect.stringContaining("requires confirmation") }]);
  const elicit = vi.fn().mockResolvedValue({ action: "decline" });
  await tool.execute({ prompt: brief, mode: "deep" }, { context: { model: "model", elicit }, emitCustomEvent() {} });
  expect(client.guard).not.toHaveBeenCalled();
  elicit.mockResolvedValue({ action: "accept" });
  complete.mockResolvedValueOnce(answer("Research report"));
  expect(
    await tool.execute({ prompt: brief, mode: "deep" }, { context: { model: "model", elicit }, emitCustomEvent() {} }),
  ).toEqual([{ type: "text", content: "Research report" }]);
  expect(client.guard).toHaveBeenCalledOnce();
});

it("exposes one tool and runs fast mode without a child model call", async () => {
  const { client, complete, tools } = fixture();
  expect(tools.map((tool) => tool.name)).toEqual(["web_research"]);
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: "topic", mode: "fast" }))
    .mockResolvedValueOnce(answer("Answer with source"));
  const result = await run(client, "model", "", [userMessage("Quick lookup")], tools);
  expect(result.status).toBe("completed");
  expect(complete).toHaveBeenCalledTimes(2);
  expect(client.guard).toHaveBeenCalledOnce();
  expect(client.search).toHaveBeenCalledWith(
    "search",
    "topic",
    { domains: [], limit: 3 },
    { signal: expect.any(AbortSignal) },
  );
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain("Evidence");
});

it.each(["flagged", "unavailable"])("fast mode fails closed when the guard is %s", async (failure) => {
  const { client, complete, tools } = fixture();
  if (failure === "flagged") client.guard.mockResolvedValue({ flagged: true, categories: [] });
  else client.guard.mockRejectedValue(new Error("offline"));
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: "topic", mode: "fast" }))
    .mockResolvedValueOnce(answer("Cannot research"));
  await run(client, "model", "", [userMessage("Quick lookup")], tools);
  expect(client.search).not.toHaveBeenCalled();
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain(
    failure === "flagged" ? "Request blocked" : "not available",
  );
});

it.each([true, false])("fast mode restores one native approval (approved=%s)", async (approved) => {
  const { client, complete, tools } = fixture(true);
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: "topic", mode: "fast" }))
    .mockResolvedValueOnce(answer("Done"));
  const original = chatSession(client, tools);
  await original.ai.sendMessage("Find a fact");
  expect(client.guard).not.toHaveBeenCalled();
  await expect.poll(() => original.store.value?.resume?.pendingInterrupts?.length).toBe(1);
  original.ai.dispose();
  const restored = chatSession(client, tools, original.store);
  await expect.poll(() => restored.ai.getInterruptState().interrupts.length).toBe(1);
  boundInterrupt(restored.ai.getInterruptState().interrupts[0]).resolveInterrupt(approved);
  await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
  expect(client.guard).toHaveBeenCalledTimes(approved ? 1 : 0);
  expect(client.search).toHaveBeenCalledTimes(approved ? 1 : 0);
  expect(complete).toHaveBeenCalledTimes(2);
  restored.ai.dispose();
});

it("fast mode preserves realtime confirmation and skips model calls", async () => {
  const { client, complete, tools } = fixture(true);
  const tool = tools[0];
  const args = { prompt: "topic", mode: "fast" };
  expect(await tool.execute(args, { context: { model: "model" }, emitCustomEvent() {} })).toEqual([
    { type: "text", content: expect.stringContaining("requires confirmation") },
  ]);
  const elicit = vi.fn().mockResolvedValue({ action: "decline" });
  await tool.execute(args, { context: { model: "model", elicit }, emitCustomEvent() {} });
  expect(client.guard).not.toHaveBeenCalled();
  elicit.mockResolvedValue({ action: "accept" });
  const result = await tool.execute(args, { context: { model: "model", elicit }, emitCustomEvent() {} });
  expect(JSON.stringify(result)).toContain("Evidence");
  expect(complete).not.toHaveBeenCalled();
  expect(client.guard).toHaveBeenCalledOnce();
  expect(client.search).toHaveBeenCalledOnce();
});

it("asks once for a deep task with multiple internal search calls", async () => {
  const { client, complete, tools } = fixture(true);
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: brief, mode: "deep" }))
    .mockResolvedValueOnce(
      toolCallMessage([
        { id: "q1", name: "web_search", arguments: JSON.stringify({ queries: ["one", "two"] }) },
        { id: "q2", name: "web_search", arguments: JSON.stringify({ queries: ["three"] }) },
      ]),
    )
    .mockResolvedValueOnce(answer("Research report"))
    .mockResolvedValueOnce(answer("Final answer"));
  const session = chatSession(client, tools);
  await session.ai.sendMessage("Research the whole task");
  await expect.poll(() => session.ai.getInterruptState().interrupts.length).toBe(1);
  expect(client.search).not.toHaveBeenCalled();
  boundInterrupt(session.ai.getInterruptState().interrupts[0]).resolveInterrupt(true);
  await expect.poll(() => session.finished.at(-1)?.status).toBe("completed");
  expect(client.guard).toHaveBeenCalledOnce();
  expect(client.search).toHaveBeenCalledTimes(3);
  expect(session.ai.getInterruptState().interrupts).toHaveLength(0);
  session.ai.dispose();
});

it.each([
  { config: {}, modes: [] },
  { config: { model: "unused" }, modes: [] },
  { config: { searcher: "search" }, modes: ["fast", "deep"] },
  { config: { scraper: "scrape" }, modes: ["deep"] },
  { config: { researcher: "remote" }, modes: ["deep"] },
  { config: { searcher: "search", researcher: "remote" }, modes: ["fast", "deep"] },
])("exposes only supported research modes for $config", ({ config, modes }) => {
  const { client } = fixture();
  const provider = createInternetProvider(client, config);
  if (!modes.length) expect(provider).toBeNull();
  else {
    expect(provider!.tools).toHaveLength(1);
    const props = convertSchemaToJsonSchema(provider!.tools[0].inputSchema)!.properties as { mode: { enum: string[] } };
    expect(props.mode.enum).toEqual(modes);
  }
});

it("routes deep mode to the configured researcher and fast mode to the searcher", async () => {
  const { client, complete } = fixture();
  const remote = Object.assign(client, { research: vi.fn<Client["research"]>().mockResolvedValue("Gateway findings") });
  const tools = createInternetProvider(remote, {
    researcher: "remote",
    searcher: "search",
    scraper: "scrape",
    model: "unused-local-model",
  })!.tools;
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: brief, mode: "deep" }))
    .mockResolvedValueOnce(answer("Final"));
  await run(client, "parent-model", "", [userMessage("Research")], tools);
  expect(remote.research).toHaveBeenCalledWith("remote", brief, { signal: expect.any(AbortSignal) });
  expect(complete).toHaveBeenCalledTimes(2);
  expect(client.search).not.toHaveBeenCalled();
  expect(client.scrape).not.toHaveBeenCalled();
  await tools[0].execute({ prompt: "topic", mode: "fast" });
  expect(client.search).toHaveBeenCalledOnce();
  expect(remote.research).toHaveBeenCalledOnce();
});

it("supports researcher-only realtime tasks without a local model", async () => {
  const { client, complete } = fixture();
  const remote = Object.assign(client, { research: vi.fn<Client["research"]>().mockResolvedValue("Gateway findings") });
  const tool = createInternetProvider(remote, { researcher: "remote" })!.tools[0];
  expect(await tool.execute({ prompt: brief })).toEqual([{ type: "text", content: "Gateway findings" }]);
  expect(complete).not.toHaveBeenCalled();
  expect(client.guard).toHaveBeenCalledOnce();
});

it("defaults scraper-only tasks to a local deep agent with only page reading available", async () => {
  const { client, complete } = fixture();
  const tools = createInternetProvider(client, { scraper: "scrape", model: "reader" })!.tools;
  expect(tools[0].subagent!.tools.map(({ name }) => name)).toEqual(["web_fetch"]);
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: "Read https://example.com" }))
    .mockResolvedValueOnce(call("web_fetch", { urls: ["https://example.com"] }))
    .mockResolvedValueOnce(answer("Page findings"))
    .mockResolvedValueOnce(answer("Final"));
  await run(client, "parent", "", [userMessage("Read this page")], tools);
  expect(client.guard).toHaveBeenCalledOnce();
  expect(client.scrape).toHaveBeenCalledOnce();
  expect(client.search).not.toHaveBeenCalled();
  expect(complete.mock.calls.map(([request]) => request.model)).toEqual(["parent", "reader", "reader", "parent"]);
});

it("restores native approval for a researcher-only task before contacting the gateway", async () => {
  const { client, complete } = fixture();
  const remote = Object.assign(client, { research: vi.fn<Client["research"]>().mockResolvedValue("Gateway findings") });
  const tools = createInternetProvider(remote, { researcher: "remote", elicitation: true })!.tools;
  complete.mockResolvedValueOnce(call("web_research", { prompt: brief })).mockResolvedValueOnce(answer("Final"));
  const original = chatSession(client, tools);
  await original.ai.sendMessage("Research this");
  expect(client.guard).not.toHaveBeenCalled();
  expect(remote.research).not.toHaveBeenCalled();
  await expect.poll(() => original.store.value?.resume?.pendingInterrupts?.length).toBe(1);
  original.ai.dispose();
  const restored = chatSession(client, tools, original.store);
  await expect.poll(() => restored.ai.getInterruptState().interrupts.length).toBe(1);
  boundInterrupt(restored.ai.getInterruptState().interrupts[0]).resolveInterrupt(true);
  await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
  expect(client.guard).toHaveBeenCalledOnce();
  expect(remote.research).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledTimes(2);
  restored.ai.dispose();
});

it.each(["fast", "deep"])("does not begin %s work when cancellation arrives during the guard check", async (mode) => {
  const { client, complete } = fixture();
  const remote = Object.assign(client, { research: vi.fn<Client["research"]>() });
  const controller = new AbortController();
  client.guard.mockImplementation(async () => {
    controller.abort();
    return { flagged: false, categories: [] };
  });
  const tool = createInternetProvider(remote, { searcher: "search", researcher: "remote" })!.tools[0];
  await expect(
    tool.execute({ prompt: brief, mode }, { context: undefined, abortSignal: controller.signal, emitCustomEvent() {} }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(client.guard).toHaveBeenCalledOnce();
  expect(client.search).not.toHaveBeenCalled();
  expect(remote.research).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it.each(["flagged", "unavailable"])("does not call a configured researcher when the guard is %s", async (failure) => {
  const { client } = fixture();
  const remote = Object.assign(client, { research: vi.fn<Client["research"]>() });
  if (failure === "flagged") client.guard.mockResolvedValue({ flagged: true, categories: [] });
  else client.guard.mockRejectedValue(new Error("offline"));
  const tool = createInternetProvider(remote, { researcher: "remote", guard: "selected-guard" })!.tools[0];
  const result = await tool.execute({ prompt: brief });
  expect(remote.research).not.toHaveBeenCalled();
  expect(client.guard).toHaveBeenCalledWith("selected-guard", brief, { signal: expect.any(AbortSignal) });
  expect(JSON.stringify(result)).toContain(failure === "flagged" ? "Request blocked" : "not available");
});

it("reports an expired direct research deadline as a timeout", async () => {
  const { client, complete, tools } = fixture();
  client.guard.mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
  complete
    .mockResolvedValueOnce(call("web_research", { prompt: brief }))
    .mockResolvedValueOnce(answer("Could not search"));
  const result = await run(client, "model", "", [userMessage("Research")], tools);
  const child = result.messages.flatMap((message) => message.parts).find((part) => part.type === "subagent");
  expect(child?.subagent.status).toBe("error");
  expect(JSON.stringify(result.messages)).toContain("timed out");
  expect(client.search).not.toHaveBeenCalled();
});
