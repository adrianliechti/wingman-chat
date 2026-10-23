import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AudioRecorder } from "./AudioRecorder";
import { AudioStreamPlayer } from "./AudioStreamPlayer";
import { FakeWorklet, installAudioFakes } from "./audioTestSupport";

let audio: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  audio = installAudioFakes();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function processor(kind: "recorder" | "player") {
  if (kind === "recorder") await new AudioRecorder().begin();
  else await new AudioStreamPlayer().connect();
  const code = await [...audio.blobs.values()][0].text();
  const sent: Record<string, any>[] = [];
  class Base {
    port = {
      onmessage: (_event: { data: Record<string, unknown> }) => {},
      postMessage: (data: Record<string, any>) => sent.push(data),
    };
    process(_inputs: Float32Array[][], _outputs: Float32Array[][]): boolean {
      return true;
    }
  }
  let Processor = Base;
  // Execute the exact blob loaded into the browser worklet; these tests don't mirror its algorithm.
  // oxlint-disable-next-line typescript/no-implied-eval -- Test the exact trusted worklet blob in an isolated processor harness.
  new Function("AudioWorkletProcessor", "registerProcessor", code)(Base, (_name: string, ctor: typeof Base) => {
    Processor = ctor;
  });
  const instance = new Processor();
  return {
    sent,
    send: (data: Record<string, unknown>) => instance.port.onmessage({ data }),
    render: (input: number[], length = 4) => {
      const output = new Float32Array(length);
      instance.process([[new Float32Array(input)]], [[output]]);
      return Array.from(output);
    },
  };
}

it("records clamped PCM16 and tags chunks with the recording generation", async () => {
  const p = await processor("recorder");
  p.render([1]);
  expect(p.sent).toEqual([]);
  p.send({ event: "start", recordingId: 7 });
  p.render([0, 0]);
  expect(p.sent).toEqual([]);
  expect(p.render([-2, -1, 0, 0.5, 1, 2])).toEqual([0, 0, 0, 0]); // no mic monitoring
  expect(p.sent[0].recordingId).toBe(7);
  expect(Array.from(new Int16Array(p.sent[0].mono))).toEqual([-32768, -32768, 0, 16383, 32767, 32767]);
  p.send({ event: "stop" });
  p.render([1]);
  expect(p.sent).toHaveLength(1);
});

it("rejects queued chunks from before a pause when recording resumes", async () => {
  const recorder = new AudioRecorder();
  await recorder.begin();
  const callback = vi.fn();
  await recorder.record(callback);
  await recorder.pause();
  await recorder.record(callback);
  FakeWorklet.instances[0].receive({ event: "chunk", recordingId: 1, mono: new Int16Array([1]).buffer });
  FakeWorklet.instances[0].receive({ event: "chunk", recordingId: 2, mono: new Int16Array([2]).buffer });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(Array.from(new Int16Array(callback.mock.calls[0][0].mono))).toEqual([2]);
  await recorder.end();
});

it("reports samples actually played and drops all interrupted tracks, including queued middle tracks", async () => {
  const p = await processor("player");
  p.send({ event: "write", trackId: "a", buffer: new Int16Array(10).fill(16384) });
  p.send({ event: "write", trackId: "b", buffer: new Int16Array(10).fill(16384) });
  p.send({ event: "write", trackId: "c", buffer: new Int16Array(10).fill(16384) });
  expect(p.render([])).toEqual([0.5, 0.5, 0.5, 0.5]);
  p.send({ event: "interrupt", requestId: 12 });
  expect(p.sent[0]).toEqual({ event: "interrupted", requestId: 12, trackId: "a", offset: 4, wasPlaying: true });
  for (const trackId of ["a", "b", "c"]) p.send({ event: "write", trackId, buffer: new Int16Array([100]) });
  expect(p.render([])).toEqual([0, 0, 0, 0]);
  p.send({ event: "write", trackId: "d", buffer: new Int16Array([-32768]) });
  expect(p.render([])).toEqual([-1, 0, 0, 0]);
});

it("distinguishes fully drained playback from a queued but unheard new track", async () => {
  const p = await processor("player");
  p.send({ event: "write", trackId: "a", buffer: new Int16Array(4) });
  p.render([]);
  p.send({ event: "interrupt", requestId: 1 });
  expect(p.sent[0]).toMatchObject({ trackId: "a", offset: 4, wasPlaying: false });
  p.send({ event: "write", trackId: "b", buffer: new Int16Array(4) });
  p.send({ event: "interrupt", requestId: 2 });
  expect(p.sent[1]).toMatchObject({ trackId: "b", offset: 0, wasPlaying: true });
});

it("correlates concurrent interrupt replies and ignores duplicates", async () => {
  const player = new AudioStreamPlayer();
  await player.connect();
  const first = player.interrupt();
  const second = player.interrupt();
  const port = FakeWorklet.instances[0];
  port.receive({ event: "interrupted", requestId: 2, trackId: "second", offset: 2, wasPlaying: true });
  port.receive({ event: "interrupted", requestId: 2, trackId: "duplicate", offset: 99 });
  port.receive({ event: "interrupted", requestId: 1, trackId: "first", offset: 1, wasPlaying: true });
  expect(await first).toMatchObject({ trackId: "first", offsetSamples: 1 });
  expect(await second).toMatchObject({ trackId: "second", offsetSamples: 2 });
  await player.disconnect();
});

it("settles an unanswered interrupt and releases playback instead of hanging", async () => {
  vi.useFakeTimers();
  try {
    const onError = vi.fn();
    const player = new AudioStreamPlayer({ onError });
    await player.connect();
    const interrupted = player.interrupt();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await interrupted).toEqual({ trackId: null, offsetSamples: 0, wasPlaying: false });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(FakeWorklet.instances[0].port.close).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
