import { expect, it, vi } from "vitest";
import { run } from "@/shared/lib/agent";
import { testClient } from "@/shared/lib/test-support/ai";
import { chatSession, boundInterrupt } from "@/shared/lib/test-support/chatSession";
import type { Client } from "@/shared/lib/client";
import type { Message } from "@/shared/types/chat";
import { createInternetProvider } from "./useInternetProvider";

const answer = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (name: string, args: object): Message => ({
  role: "assistant",
  content: [{ type: "tool_call", id: name, name, arguments: JSON.stringify(args) }],
});
const brief = "Find sources about the requested topic";
function fixture(elicitation = false) {
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
  })!;
  return { complete, client, tools: provider.tools };
}

it("streams research as a native child with a self-contained brief and child cancellation", async () => {
  const { client, complete, tools } = fixture();
  complete
    .mockResolvedValueOnce(call("search_agent", { prompt: brief }))
    .mockResolvedValueOnce(call("web_search", { queries: ["topic"], domains: ["example.com"] }))
    .mockResolvedValueOnce(call("web_fetch", { urls: ["https://example.com"] }))
    .mockResolvedValueOnce(answer("Report with sources"))
    .mockResolvedValueOnce(answer("Parent answer"));
  const result = await run(
    client,
    "parent-model",
    "",
    [{ role: "user", content: [{ type: "text", text: "Unrelated parent details" }] }],
    tools,
  );
  expect(result.status).toBe("completed");
  expect(client.guard).toHaveBeenCalledOnce();
  expect(client.guard.mock.calls[0][1]).toContain(brief);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain(brief);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).not.toContain("Unrelated parent details");
  expect(complete.mock.calls[1][0].model).toBe("parent-model");
  const signal = complete.mock.calls[1][0].request?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(client.search).toHaveBeenCalledWith("search", "topic", { domains: ["example.com"] }, { signal });
  expect(client.scrape).toHaveBeenCalledWith("scrape", "https://example.com", { signal });
  const child = result.messages.flatMap((message) => message.content).find((part) => part.type === "subagent");
  expect(child?.status).toBe("finished");
  expect(JSON.stringify(child)).toContain("web_search");
  expect(JSON.stringify(child)).toContain("Fetched evidence");
  expect(JSON.stringify(complete.mock.calls.at(-1)?.[0].messages)).toContain("Report with sources");
});

it.each([true, false])("restores research approval before starting the child (approved=%s)", async (approved) => {
  const { client, complete, tools } = fixture(true);
  complete.mockResolvedValueOnce(call("search_agent", { prompt: brief }));
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
    .mockResolvedValueOnce(call("search_agent", { prompt: brief }))
    .mockResolvedValueOnce(answer("Cannot research"));
  const result = await run(
    client,
    "model",
    "",
    [{ role: "user", content: [{ type: "text", text: "Research" }] }],
    tools,
  );
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
  expect(await tool.function({ prompt: brief }, { model: "model" })).toEqual([
    { type: "text", text: expect.stringContaining("requires confirmation") },
  ]);
  const elicit = vi.fn().mockResolvedValue({ action: "decline" });
  await tool.function({ prompt: brief }, { model: "model", elicit });
  expect(client.guard).not.toHaveBeenCalled();
  elicit.mockResolvedValue({ action: "accept" });
  complete.mockResolvedValueOnce(answer("Research report"));
  expect(await tool.function({ prompt: brief }, { model: "model", elicit })).toEqual([
    { type: "text", text: "Research report" },
  ]);
  expect(client.guard).toHaveBeenCalledOnce();
});
