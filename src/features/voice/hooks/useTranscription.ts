import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder } from "@/features/voice/lib/AudioRecorder";
import { mergePcm16Chunks, pcm16ToWav } from "@/features/voice/lib/audio";
import { AudioResources } from "@/shared/lib/audioResources";
import { notify } from "@/shared/lib/notify";
import { getConfig } from "@/shared/config";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";
import { resolveModel } from "@/shared/lib/modelSelection";

export interface UseTranscriptionReturn {
  canTranscribe: boolean;
  /** Includes microphone permission/setup, so the same button can cancel a delayed start. */
  isTranscribing: boolean;
  startTranscription: () => Promise<void>;
  stopTranscription: () => Promise<string>;
}

interface Dictation {
  scope: AudioResources;
  recorder: AudioRecorder;
  chunks: Int16Array[];
  recording: boolean;
  stopping?: Promise<string>;
}

export function useTranscription(ownerKey?: string, enabled = true): UseTranscriptionReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const current = useRef<Dictation | null>(null);
  const { inputDeviceId } = useAudioDevices();
  const config = getConfig();
  const canTranscribe = !!(
    enabled &&
    config.stt &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia
  );

  const cancel = useCallback(() => {
    const session = current.current;
    current.current = null;
    if (session) void session.scope.close();
  }, []);

  // A recording/upload belongs to this composer and device, including while permission is pending.
  useEffect(() => {
    setIsTranscribing(false);
    return cancel;
  }, [cancel, ownerKey, inputDeviceId, enabled]);

  const startTranscription = useCallback(async () => {
    if (!canTranscribe) throw new Error("Transcription is not available");
    if (current.current) return;
    const scope = new AudioResources();
    const recorder = new AudioRecorder({
      sampleRate: 24000,
      deviceId: inputDeviceId,
      onError: (error) => {
        if (current.current?.scope !== scope) return;
        cancel();
        setIsTranscribing(false);
        notify.error("Recording stopped", error.message);
      },
    });
    const session: Dictation = { scope, recorder, chunks: [], recording: false };
    scope.own(recorder, (recorder) => recorder.end());
    current.current = session;
    setIsTranscribing(true);
    try {
      await scope.wait(recorder.begin());
      scope.signal.throwIfAborted();
      await recorder.record((chunk) => {
        if (current.current === session && !session.stopping) session.chunks.push(new Int16Array(chunk.mono));
      });
      scope.signal.throwIfAborted();
      session.recording = true;
    } catch (error) {
      const cancelled = scope.signal.aborted;
      if (current.current === session) {
        current.current = null;
        setIsTranscribing(false);
      }
      await scope.close();
      if (!cancelled) throw error;
    }
  }, [canTranscribe, inputDeviceId, cancel]);

  const stopTranscription = useCallback((): Promise<string> => {
    const session = current.current;
    if (!session) return Promise.resolve("");
    if (session.stopping) return session.stopping;
    setIsTranscribing(false);
    if (!session.recording) {
      cancel();
      return Promise.resolve("");
    }
    session.stopping = (async () => {
      try {
        await session.recorder.end();
        session.scope.signal.throwIfAborted();
        if (!session.chunks.length) throw new Error("No audio recorded");
        const audio = pcm16ToWav(mergePcm16Chunks(session.chunks), 24000);
        session.chunks = [];
        const config = getConfig();
        const model = await session.scope.wait(resolveModel(config.stt?.model, "transcriber"));
        const text = await session.scope.wait(config.client.transcribe(model, audio, { signal: session.scope.signal }));
        session.scope.signal.throwIfAborted();
        return text;
      } catch (error) {
        if (session.scope.signal.aborted) return "";
        throw error;
      } finally {
        if (current.current === session) current.current = null;
        await session.scope.close();
      }
    })();
    return session.stopping;
  }, [cancel]);

  return { canTranscribe, isTranscribing, startTranscription, stopTranscription };
}
