import { extractAudioForTranscription } from "../../../src/features/tools/lib/extractAudio";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceProvider } from "../../../src/features/voice/context/VoiceProvider";
import { useVoice } from "../../../src/features/voice/hooks/useVoice";
import { useTranscription } from "../../../src/features/voice/hooks/useTranscription";
import { AudioDeviceProvider } from "../../../src/shell/context/AudioDeviceProvider";
import { useAudioDevices } from "../../../src/shell/hooks/useAudioDevices";
import { ChatContextProviders } from "../../../src/features/chat/context/ChatContextProviders";
import { type ChatContextType } from "../../../src/features/chat/context/ChatContext";
import { AgentContext, type AgentContextType } from "../../../src/features/agent/context/AgentContext";
import { ProfileContext } from "../../../src/features/settings/context/ProfileContext";
import { ToolsContext, type ToolsContextValue } from "../../../src/features/tools/context/ToolsContext";
import { ArtifactsContext, type ArtifactsContextType } from "../../../src/features/artifacts/context/ArtifactsContext";
import { PlayButton } from "../../../src/shared/ui/PlayButton";
import { loadConfig } from "../../../src/shared/config";
import { ProviderState, type Chat, type Model, type Tool } from "../../../src/shared/types/chat";

await loadConfig();

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const contexts: AudioContext[] = [];
const streams: MediaStream[] = [];
const urls = new Set<string>();
let recorderChunks = 0;
let permission: ReturnType<typeof gate> | undefined;
let ensure: ReturnType<typeof gate> | undefined;
let closing: ReturnType<typeof gate> | undefined;
let holdClose = false;
let starting = Promise.resolve();
const errors: string[] = [];

// Track real browser resources; only permission and close completion can be delayed.
const NativeContext = window.AudioContext;
window.AudioContext = new Proxy(NativeContext, {
  construct(target, args) {
    const context = Reflect.construct(target, args) as AudioContext;
    contexts.push(context);
    const close = context.close.bind(context);
    context.close = async () => {
      const delayed = holdClose;
      holdClose = false;
      await close();
      if (delayed) {
        closing ??= gate();
        await closing.promise;
      }
    };
    return context;
  },
});
const NativeWorklet = window.AudioWorkletNode;
window.AudioWorkletNode = new Proxy(NativeWorklet, {
  construct(target, args) {
    const node = Reflect.construct(target, args) as AudioWorkletNode;
    if (args[1] === "audio-processor")
      node.port.addEventListener("message", (event) => {
        if (event.data?.event === "chunk") recorderChunks++;
      });
    return node;
  },
});
if (navigator.mediaDevices) {
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const pending = permission;
    permission = undefined;
    const stream = await getUserMedia(constraints);
    streams.push(stream);
    if (pending) await pending.promise;
    return stream;
  };
}
const createURL = URL.createObjectURL.bind(URL);
const revokeURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = createURL(blob);
  urls.add(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  urls.delete(url);
  revokeURL(url);
};

let releasePermission = () => {};
const noop = () => {};
const models: Model[] = [
  { id: "realtime", name: "Voice" },
  { id: "text", name: "Text" },
];
const agents = { currentAgent: null } as AgentContextType;
const toolGate = gate();
let toolStarted = false;
let elicitationCount = 0;
const delayedTool: Tool = {
  name: "late_elicitation",
  parameters: { type: "object", properties: {} },
  function: async (_args, context) => {
    toolStarted = true;
    await toolGate.promise;
    await context!.elicit!({ message: "Continue?" });
    return [];
  },
};
const tools = {
  providers: new URLSearchParams(location.search).has("late-tool") ? [{ id: "test", tools: [delayedTool] }] : [],
  getProviderState: () => ProviderState.Connected,
} as unknown as ToolsContextValue;
const profile = { generateInstructions: () => "Test instructions" } as NonNullable<
  React.ContextType<typeof ProfileContext>
>;
const artifacts = { isAvailable: false, fs: null, activeFile: null } as ArtifactsContextType;

function Consumer({ chatId, realtime, showPlay }: { chatId: string; realtime: boolean; showPlay: boolean }) {
  const voice = useVoice();
  const dictation = useTranscription(chatId, !realtime);
  const devices = useAudioDevices();
  window.voiceE2E = {
    ...window.voiceControls,
    state: () => ({
      listening: voice.isListening,
      connecting: voice.isConnecting,
      recording: dictation.isTranscribing,
      level: voice.audioLevel,
      input: devices.inputDeviceId,
      output: devices.outputDeviceId,
    }),
    releaseTool: toolGate.release,
    toolState: () => ({ started: toolStarted, elicitations: elicitationCount }),
    sendText: voice.sendText,
    startVoice: () => {
      starting = voice.startVoice().catch((error: unknown) => {
        errors.push(String(error));
      });
    },
    stopVoice: voice.stopVoice,
    startDictation: () => {
      starting = dictation.startTranscription().catch((error: unknown) => {
        errors.push(String(error));
      });
    },
    stopDictation: dictation.stopTranscription,
    finishStart: () => starting,
    input: devices.setInputDevice,
    output: devices.setOutputDevice,
    permission: devices.requestPermission,
    devices: () => ({ inputs: devices.inputDevices, outputs: devices.outputDevices }),
    holdPermission: () => {
      permission = gate();
      releasePermission = permission.release;
    },
    releasePermission: () => releasePermission(),
    holdEnsure: () => {
      ensure = gate();
    },
    releaseEnsure: () => {
      ensure?.release();
      ensure = undefined;
    },
    holdClose: () => {
      holdClose = true;
    },
    releaseClose: () => {
      closing?.release();
      closing = undefined;
    },
    diagnostics: () => ({
      contexts: contexts.map((context) => context.state),
      tracks: streams.flatMap((stream) => stream.getTracks().map((track) => track.readyState)),
      openUrls: urls.size,
      errors,
      recorderChunks,
      playbackTime: contexts[0]?.currentTime ?? 0,
    }),
    extractSyntheticAudio: async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      const recorder = new MediaRecorder(destination.stream, { mimeType: "audio/webm;codecs=opus" });
      const chunks: Blob[] = [];
      try {
        const recorded = new Promise<Blob>((resolve, reject) => {
          recorder.ondataavailable = (event) => {
            chunks.push(event.data);
            if (recorder.state === "recording") recorder.stop();
          };
          recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
          recorder.onerror = () => reject(new Error("Synthetic recording failed"));
        });
        oscillator.start();
        recorder.start(100);
        const input = new Uint8Array(await (await recorded).arrayBuffer());
        const output = await extractAudioForTranscription(input, "video/webm", "wav");
        const decoded = await context.decodeAudioData(await output.arrayBuffer());
        return { type: output.type, channels: decoded.numberOfChannels, duration: decoded.duration };
      } finally {
        if (recorder.state !== "inactive") recorder.stop();
        oscillator.stop();
        oscillator.disconnect();
        destination.stream.getTracks().forEach((track) => track.stop());
        destination.disconnect();
        await context.close();
      }
    },
    disconnectMic: () => {
      const track = streams.at(-1)!.getAudioTracks()[0];
      track.stop();
      track.dispatchEvent(new Event("ended"));
    },
  };
  return <>{showPlay && <PlayButton text="A synthetic test message." voice="narrator" />}</>;
}

function Owner() {
  const [show, setShow] = useState(true);
  const [showPlay, setShowPlay] = useState(true);
  const [chatId, setChatId] = useState("first");
  const [model, setModel] = useState(models[0]);
  window.voiceControls = {
    show: setShow,
    showPlay: setShowPlay,
    chat: setChatId,
    mode: (voice: boolean) => setModel(models[voice ? 0 : 1]),
  };
  const chat = { id: chatId, model, messages: [] } as unknown as Chat;
  const context = {
    chat,
    chatId,
    model,
    models,
    messages: [],
    setModel,
    ensureChat: async () => {
      if (ensure) await ensure.promise;
      return { chat };
    },
    addMessage: async () => {},
    requestElicitation: async () => {
      elicitationCount++;
      return { action: "cancel" };
    },
    setVoiceToolCall: noop,
    updateToolMeta: noop,
  } as unknown as ChatContextType;
  return show ? (
    <ChatContextProviders value={context}>
      <AgentContext value={agents}>
        <ToolsContext value={tools}>
          <ProfileContext value={profile}>
            <ArtifactsContext value={artifacts}>
              <AudioDeviceProvider>
                <VoiceProvider>
                  <Consumer chatId={chatId} realtime={model.id === "realtime"} showPlay={showPlay} />
                </VoiceProvider>
              </AudioDeviceProvider>
            </ArtifactsContext>
          </ProfileContext>
        </ToolsContext>
      </AgentContext>
    </ChatContextProviders>
  ) : null;
}

declare global {
  interface Window {
    voiceControls: {
      show: (show: boolean) => void;
      showPlay: (show: boolean) => void;
      chat: (id: string) => void;
      mode: (voice: boolean) => void;
    };
    voiceE2E: Window["voiceControls"] & {
      state: () => {
        listening: boolean;
        connecting: boolean;
        recording: boolean;
        level: number;
        input?: string;
        output?: string;
      };
      startVoice: () => void;
      releaseTool: () => void;
      toolState: () => { started: boolean; elicitations: number };
      sendText: (text: string) => void;
      stopVoice: () => Promise<void>;
      startDictation: () => void;
      stopDictation: () => Promise<string>;
      finishStart: () => Promise<void>;
      input: (id?: string) => void;
      output: (id?: string) => void;
      permission: () => Promise<void>;
      devices: () => { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] };
      holdPermission: () => void;
      releasePermission: () => void;
      holdEnsure: () => void;
      releaseEnsure: () => void;
      holdClose: () => void;
      releaseClose: () => void;
      diagnostics: () => {
        contexts: AudioContextState[];
        tracks: MediaStreamTrackState[];
        openUrls: number;
        errors: string[];
        recorderChunks: number;
        playbackTime: number;
      };
      disconnectMic: () => void;
      extractSyntheticAudio: () => Promise<{ type: string; channels: number; duration: number }>;
    };
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Owner />
  </StrictMode>,
);
