import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "./client";
import { pcm16ToWav } from "@/features/voice/lib/audio";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("speech API contracts", () => {
  it("sends speech model/voice/text, requests WAV, and checks the returned bytes", async () => {
    fetchMock.mockResolvedValueOnce(new Response("wav-bytes"));
    const result = await new Client().generateAudio("synthesizer", "Hello", "voice-id");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url instanceof Request ? url.url : url.toString()).toBe("http://localhost/api/v1/audio/speech");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      model: "synthesizer",
      input: "Hello",
      voice: "voice-id",
      response_format: "wav",
    });
    expect(result.type).toBe("audio/wav");
    expect(await result.text()).toBe("wav-bytes");
    fetchMock.mockResolvedValueOnce(new Response(""));
    await expect(new Client().generateAudio("tts", "Hello")).rejects.toThrow("empty audio");
  });

  it.each(["audio/webm;codecs=opus", "audio/mp4", "audio/ogg", "audio/wav"])(
    "uploads %s with a matching filename and configured STT model",
    async (type) => {
      fetchMock.mockResolvedValueOnce(Response.json({ text: "Transcript" }));
      expect(await new Client().transcribe("transcriber", new Blob(["audio"], { type }))).toBe("Transcript");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url instanceof Request ? url.url : url.toString()).toBe("http://localhost/api/v1/audio/transcriptions");
      const body = init!.body as FormData;
      expect(body.get("model")).toBe("transcriber");
      expect((body.get("file") as File).name).toBe(
        `audio_recording.${{ "audio/webm;codecs=opus": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav" }[type]}`,
      );
      expect(init!.headers).toBeUndefined(); // fetch supplies the multipart boundary
    },
  );

  it("omits an unspecified STT model, accepts silence and rejects malformed responses", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ text: "" }));
    expect(await new Client().transcribe("", new Blob(["audio"]))).toBe("");
    expect((fetchMock.mock.calls[0][1]!.body as FormData).has("model")).toBe(false);
    for (const body of [{}, { text: 17 }, null]) {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      await expect(new Client().transcribe("stt", new Blob(["audio"]))).rejects.toThrow("invalid response");
    }
    await expect(new Client().transcribe("stt", new Blob())).rejects.toThrow("No audio");
  });

  it.each(["tts", "stt"])("cancels %s at the HTTP request and rejects pre-aborted work", async (mode) => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url, init) => {
      signal = init!.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }),
      );
    });
    const client = new Client();
    const invoke = () =>
      mode === "tts"
        ? client.generateAudio("tts", "Hello", undefined, { signal: controller.signal })
        : client.transcribe("stt", new Blob(["audio"]), { signal: controller.signal });
    const result = invoke().catch((error: unknown) => error);
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.abort();
    expect(await result).toMatchObject({ name: expect.stringMatching(/Abort/) });
    const calls = fetchMock.mock.calls.length;
    await expect(invoke()).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("produces a mono PCM16 WAV with matching lengths, rate and signed samples", async () => {
    const samples = new Int16Array([-32768, 0, 32767]);
    const bytes = await pcm16ToWav(samples, 24000).arrayBuffer();
    const view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(Array.from(new Int16Array(bytes.slice(44)))).toEqual(Array.from(samples));
  });
});
