import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { pcm16ToWav } from "../../src/features/voice/lib/audio";

// Real AudioContexts/worklets with Chromium's synthetic microphone, never the host microphone.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  },
  permissions: ["microphone"],
});

async function open(page: Page) {
  const sockets: { route: WebSocketRoute; frames: Record<string, any>[]; closed: boolean }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        voice: { model: "realtime-test", transcriber: "stt-test" },
        stt: { model: "stt-test" },
        tts: { model: "tts-test", voices: { narrator: "voice-test" } },
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/realtime?*", (route) => {
    const socket = { route, frames: [] as Record<string, any>[], closed: false };
    sockets.push(socket);
    route.onMessage((data) => {
      const frame = JSON.parse(String(data));
      socket.frames.push(frame);
      if (frame.type === "session.update") route.send(JSON.stringify({ type: "session.updated" }));
    });
    route.onClose(() => {
      socket.closed = true;
    });
  });
  await page.goto("/tests/browser/fixtures/voice.html");
  await page.waitForFunction(() => !!window.voiceE2E);
  return { sockets, errors };
}

async function stopped(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.voiceE2E.diagnostics()))
    .toMatchObject({
      contexts: expect.not.arrayContaining(["running", "suspended"]),
      tracks: expect.not.arrayContaining(["live"]),
      openUrls: 0,
    });
}

test("real worklets record PCM, play and interrupt PCM, then release the entire session", async ({ page }) => {
  const { sockets, errors } = await open(page);
  await page.evaluate(() => window.voiceE2E.startVoice());
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  await expect
    .poll(() => sockets[0]?.frames.filter((frame) => frame.type === "input_audio_buffer.append").length)
    .toBeGreaterThan(4);
  const audio = Buffer.from(new Int16Array(24000).fill(500).buffer).toString("base64");
  sockets[0].route.send(JSON.stringify({ type: "response.created", response: { id: "response" } }));
  sockets[0].route.send(
    JSON.stringify({ type: "response.output_audio.delta", response_id: "response", item_id: "item", delta: audio }),
  );
  const startTime = await page.evaluate(() => window.voiceE2E.diagnostics().playbackTime);
  await page.waitForFunction((time) => window.voiceE2E.diagnostics().playbackTime > time + 0.1, startTime);
  sockets[0].route.send(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
  await expect.poll(() => sockets[0].frames.some((frame) => frame.type === "conversation.item.truncate")).toBe(true);
  await page.evaluate(() => window.voiceE2E.stopVoice());
  await stopped(page);
  expect(errors).toEqual([]);
});

test("cancel during delayed permission, then restart while the old permission resolves", async ({ page }) => {
  const { sockets, errors } = await open(page);
  await page.evaluate(() => {
    window.voiceE2E.holdPermission();
    window.voiceE2E.startVoice();
  });
  await page.waitForFunction(() => window.voiceE2E.diagnostics().tracks.length === 1);
  await page.evaluate(() => window.voiceE2E.stopVoice());
  expect(sockets).toHaveLength(0);
  await page.evaluate(() => window.voiceE2E.startVoice());
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  await page.evaluate(() => window.voiceE2E.releasePermission());
  await expect.poll(() => page.evaluate(() => window.voiceE2E.diagnostics().tracks)).toEqual(["ended", "live"]);
  expect(sockets).toHaveLength(1);
  await page.evaluate(() => window.voiceE2E.stopVoice());
  await stopped(page);
  expect(errors).toEqual([]);
});

test("cancel before ensureChat finishes cannot acquire a microphone", async ({ page }) => {
  const { sockets } = await open(page);
  await page.evaluate(() => {
    window.voiceE2E.holdEnsure();
    window.voiceE2E.startVoice();
  });
  await page.waitForFunction(() => window.voiceE2E.state().connecting);
  await page.evaluate(() => window.voiceE2E.stopVoice());
  await page.evaluate(() => window.voiceE2E.releaseEnsure());
  await page.evaluate(() => window.voiceE2E.finishStart());
  expect(sockets).toHaveLength(0);
  expect(await page.evaluate(() => window.voiceE2E.diagnostics().tracks)).toEqual([]);
});

test("mic and speaker switches replace sessions, including a switch during permission", async ({ page }) => {
  const { sockets, errors } = await open(page);
  await page.evaluate(() => {
    window.voiceE2E.holdPermission();
    window.voiceE2E.startVoice();
  });
  await page.waitForFunction(() => window.voiceE2E.diagnostics().tracks.length === 1);
  await page.evaluate(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    window.voiceE2E.input(
      devices.find((device) => device.kind === "audioinput" && device.deviceId !== "default")!.deviceId,
    );
  });
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  await page.evaluate(() => window.voiceE2E.releasePermission());
  await page.evaluate(() => window.voiceE2E.output("default"));
  await expect.poll(() => sockets.length).toBe(2);
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  expect(sockets[0].closed).toBe(true);
  await page.evaluate(() => window.voiceE2E.stopVoice());
  await stopped(page);
  expect(errors).toEqual([]);
});

test("a slow stop cannot clear a newer listening state", async ({ page }) => {
  const { sockets } = await open(page);
  await page.evaluate(() => window.voiceE2E.startVoice());
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  await page.evaluate(() => {
    window.voiceE2E.holdClose();
    void window.voiceE2E.stopVoice();
    window.voiceE2E.startVoice();
  });
  await expect.poll(() => sockets.length).toBe(2);
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  await page.evaluate(() => window.voiceE2E.releaseClose());
  expect(await page.evaluate(() => window.voiceE2E.state().listening)).toBe(true);
  await page.evaluate(() => window.voiceE2E.stopVoice());
  await stopped(page);
});

test("unmount and chat/mode changes cancel pending voice startup", async ({ page }) => {
  for (const action of ["unmount", "chat", "mode"]) {
    const { sockets, errors } = await open(page);
    await page.evaluate(() => {
      window.voiceE2E.holdPermission();
      window.voiceE2E.startVoice();
    });
    await page.waitForFunction(() => window.voiceE2E.diagnostics().tracks.length === 1);
    await page.evaluate((action) => {
      if (action === "unmount") window.voiceE2E.show(false);
      else if (action === "chat") window.voiceE2E.chat("other");
      else window.voiceE2E.mode(false);
    }, action);
    await page.evaluate(() => window.voiceE2E.releasePermission());
    await stopped(page);
    expect(sockets).toHaveLength(0);
    expect(errors).toEqual([]);
  }
});

test("losing the microphone stops playback and updates the owner", async ({ page }) => {
  const { sockets, errors } = await open(page);
  await page.evaluate(() => window.voiceE2E.startVoice());
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  await page.evaluate(() => window.voiceE2E.disconnectMic());
  await stopped(page);
  await page.waitForFunction(() => !window.voiceE2E.state().listening && !window.voiceE2E.state().connecting);
  await expect.poll(() => sockets[0].closed).toBe(true);
  expect(errors).toEqual([]);
});

test("dictation uploads actual WAV samples and releases capture before the STT response", async ({ page }) => {
  const { errors } = await open(page);
  const pending = page.waitForRequest("**/api/v1/audio/transcriptions");
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/audio/transcriptions", async (route) => {
    await response;
    await route.fulfill({ json: { text: "Test transcript" } });
  });
  await page.evaluate(() => window.voiceE2E.mode(false));
  await page.evaluate(() => window.voiceE2E.startDictation());
  await page.evaluate(() => window.voiceE2E.finishStart());
  await page.waitForFunction(() => window.voiceE2E.diagnostics().recorderChunks > 4);
  const transcript = page.evaluate(() => window.voiceE2E.stopDictation());
  const request = await pending;
  expect(request.postDataBuffer()!.includes(Buffer.from("RIFF"))).toBe(true);
  expect(request.postDataBuffer()!.includes(Buffer.from("stt-test"))).toBe(true);
  await stopped(page);
  release();
  expect(await transcript).toBe("Test transcript");
  expect(errors).toEqual([]);
});

test("dictation cancels permission and prevents late STT text after navigation", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.voiceE2E.mode(false));
  await page.evaluate(() => {
    window.voiceE2E.holdPermission();
    window.voiceE2E.startDictation();
  });
  await page.waitForFunction(() => window.voiceE2E.diagnostics().tracks.length === 1);
  expect(await page.evaluate(() => window.voiceE2E.stopDictation())).toBe("");
  await page.evaluate(() => window.voiceE2E.releasePermission());
  await stopped(page);
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/audio/transcriptions", async (route) => {
    await response;
    await route.fulfill({ json: { text: "Stale transcript" } });
  });
  await page.evaluate(() => window.voiceE2E.startDictation());
  await page.evaluate(() => window.voiceE2E.finishStart());
  await page.waitForFunction(() => window.voiceE2E.diagnostics().recorderChunks > 4);
  const request = page.waitForRequest("**/api/v1/audio/transcriptions");
  const transcript = page.evaluate(() => window.voiceE2E.stopDictation());
  await request;
  await page.evaluate(() => window.voiceE2E.chat("other"));
  expect(await transcript).toBe("");
  release();
  await stopped(page);
});

test("read-aloud can cancel generation, stop playback, and clean up on unmount", async ({ page }) => {
  const { errors } = await open(page);
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wav = Buffer.from(await pcm16ToWav(new Int16Array(24000 * 5), 24000).arrayBuffer());
  await page.route("**/api/v1/audio/speech", async (route) => {
    await response;
    await route.fulfill({ body: wav, contentType: "audio/wav" });
  });
  const request = page.waitForRequest("**/api/v1/audio/speech");
  await page.getByRole("button", { name: "Play message" }).click();
  expect((await request).postDataJSON()).toMatchObject({ model: "tts-test", voice: "voice-test" });
  await page.getByRole("button", { name: "Cancel audio generation" }).click();
  release();
  await expect(page.getByRole("button", { name: "Play message" })).toBeVisible();
  await stopped(page);
  await page.getByRole("button", { name: "Play message" }).click();
  await page.getByRole("button", { name: "Stop playback" }).click();
  await stopped(page);
  await page.getByRole("button", { name: "Play message" }).click();
  await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
  await page.evaluate(() => window.voiceE2E.showPlay(false));
  await stopped(page);
  expect(errors).toEqual([]);
});

test("device enumeration preserves hidden preferences and ignores out-of-order results", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("app_audio_input", "preferred-mic");
    localStorage.setItem("app_audio_output", "preferred-speaker");
    const pending: Array<(devices: MediaDeviceInfo[]) => void> = [];
    let held = false;
    const device = (id: string, kind: MediaDeviceKind) =>
      ({ deviceId: id, kind, label: id, groupId: "test" }) as MediaDeviceInfo;
    const full = [
      device("default", "audioinput"),
      device("preferred-mic", "audioinput"),
      device("preferred-speaker", "audiooutput"),
    ];
    navigator.mediaDevices.enumerateDevices = () =>
      held ? new Promise((resolve) => pending.push(resolve)) : Promise.resolve([]);
    Object.assign(window, {
      deviceEnumeration: {
        full: () => {
          held = true;
          navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
          pending.at(-1)!(full);
        },
        change: () => navigator.mediaDevices.dispatchEvent(new Event("devicechange")),
        resolve: (index: number, all: boolean) => pending[index](all ? full : full.slice(0, 1)),
        count: () => pending.length,
      },
    });
  });
  await open(page);
  expect(await page.evaluate(() => window.voiceE2E.state())).toMatchObject({
    input: "preferred-mic",
    output: "preferred-speaker",
  });
  await page.evaluate(() => window.deviceEnumeration.full());
  await page.waitForFunction(() => window.voiceE2E.devices().inputs.length === 2);
  await page.evaluate(() => {
    window.deviceEnumeration.change();
    window.deviceEnumeration.change();
  });
  await page.evaluate(() => window.deviceEnumeration.resolve(2, false));
  await page.waitForFunction(() => window.voiceE2E.devices().inputs.length === 1);
  await page.evaluate(() => window.deviceEnumeration.resolve(1, true));
  expect(await page.evaluate(() => window.voiceE2E.devices().inputs.map((device) => device.deviceId))).toEqual([
    "default",
  ]);
  expect(await page.evaluate(() => window.voiceE2E.state())).toMatchObject({ input: undefined, output: undefined });
  expect(await page.evaluate(() => localStorage.getItem("app_audio_input"))).toBeNull();
});

test("permission probes coalesce and release a stream granted after provider unmount", async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(() => {
    window.voiceE2E.holdPermission();
    void window.voiceE2E.permission();
    void window.voiceE2E.permission();
  });
  await page.waitForFunction(() => window.voiceE2E.diagnostics().tracks.length === 1);
  await page.evaluate(() => window.voiceE2E.show(false));
  await page.evaluate(() => window.voiceE2E.releasePermission());
  await stopped(page);
  expect(await page.evaluate(() => window.voiceE2E.diagnostics().tracks)).toEqual(["ended"]);
  expect(errors).toEqual([]);
});

test("devices unavailable and permission denial leave the UI retryable", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  const { errors } = await open(page);
  await page.evaluate(() => window.voiceE2E.mode(false));
  await page.evaluate(() => window.voiceE2E.startDictation());
  await page.evaluate(() => window.voiceE2E.finishStart());
  expect(await page.evaluate(() => window.voiceE2E.state().recording)).toBe(false);
  expect(await page.evaluate(() => window.voiceE2E.diagnostics().errors)).toEqual([
    "NotAllowedError: Permission denied",
  ]);
  await stopped(page);
  expect(errors).toEqual([]);
  await page.addInitScript(() => Object.defineProperty(navigator, "mediaDevices", { value: undefined }));
  await page.reload();
  await page.waitForFunction(() => !!window.voiceE2E);
  expect(await page.evaluate(() => window.voiceE2E.devices())).toEqual({ inputs: [], outputs: [] });
  expect(errors).toEqual([]);
});

declare global {
  interface Window {
    deviceEnumeration: {
      full: () => void;
      change: () => void;
      resolve: (index: number, full: boolean) => void;
      count: () => number;
    };
  }
}

test("file transcription decodes and resamples a real WebM container to mono WAV", async ({ page }) => {
  const { errors } = await open(page);
  const result = await page.evaluate(() => window.voiceE2E.extractSyntheticAudio());
  expect(result.type).toBe("audio/wav");
  expect(result.channels).toBe(1);
  expect(result.duration).toBeGreaterThan(0);
  await stopped(page);
  expect(errors).toEqual([]);
});

test("realtime transcription does not inherit the file STT model", async ({ page }) => {
  const { sockets } = await open(page);
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { voice: {}, stt: { model: "file-only-transcriber" } } }),
  );
  await page.reload();
  await page.waitForFunction(() => !!window.voiceE2E);
  await page.evaluate(() => window.voiceE2E.startVoice());
  await page.waitForFunction(() => window.voiceE2E.state().listening);
  const update = sockets[0].frames.find((frame) => frame.type === "session.update");
  expect(update?.session.audio.input.transcription.model).toBe("gpt-live-transcribe");
  await page.evaluate(() => window.voiceE2E.stopVoice());
  await stopped(page);
});
