import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "./client";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => vi.unstubAllGlobals());

function respond(data: Record<string, unknown>[]) {
  fetchMock.mockResolvedValueOnce(Response.json({ object: "list", data }));
}

it("uses explicit backend types and display metadata for opaque or misleading IDs", async () => {
  respond([
    { id: "deployment-a", type: "renderer", name: "Studio", description: "Shared image model" },
    { id: "transcribe-alias", type: "realtime" },
    { id: "image-helper", type: "completer" },
  ]);
  expect(await new Client().listModels()).toEqual([
    { id: "deployment-a", type: "renderer", name: "Studio", description: "Shared image model" },
    { id: "transcribe-alias", type: "realtime", name: "Transcribe Alias" },
    { id: "image-helper", type: "completer", name: "Image Helper" },
  ]);
});

it("falls back for absent or malformed metadata without using owner or created as capabilities", async () => {
  respond([
    { id: "gpt-realtime-2.1", type: null, name: 42, description: {} },
    { id: "gpt-transcribe", type: "unsupported", name: "  " },
    { id: "local-alias", owned_by: "openai", created: Date.now() },
  ]);
  expect(await new Client().listModels()).toEqual([
    { id: "gpt-realtime-2.1", name: "GPT Realtime 2.1", type: "realtime" },
    { id: "gpt-transcribe", name: "GPT Transcribe", type: "transcriber" },
    { id: "local-alias", name: "Local Alias", type: "completer" },
  ]);
});

it("filters after resolving types, keeping realtime out of chat and file STT", async () => {
  const data = [
    { id: "gpt-live-transcribe" },
    { id: "gpt-transcribe" },
    { id: "gpt-realtime-2.1" },
    { id: "gemini-3.1-flash-live-preview" },
    { id: "gpt-4o-mini-tts" },
    { id: "gpt-5.4" },
    { id: "chat-alias", type: "synthesizer" },
  ];
  const client = new Client();
  respond(data);
  expect((await client.listModels("completer")).map((model) => model.id)).toEqual(["gpt-5.4"]);
  respond(data);
  expect((await client.listModels("transcriber")).map((model) => model.id)).toEqual(["gpt-transcribe"]);
});
