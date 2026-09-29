import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder } from "@tanstack/ai-client";
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
  recording: boolean;
  stopping?: Promise<string>;
}

async function transcribe(session: Dictation): Promise<string> {
  const { blob } = await session.scope.wait(session.recorder.stop());
  session.scope.signal.throwIfAborted();
  if (!blob.size) throw new Error("No audio recorded");
  const config = getConfig();
  const model = await session.scope.wait(resolveModel(config.stt?.model, "transcriber"));
  const text = await session.scope.wait(config.client.transcribe(model, blob, { signal: session.scope.signal }));
  session.scope.signal.throwIfAborted();
  return text;
}

export function useTranscription(ownerKey?: string, enabled = true): UseTranscriptionReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const current = useRef<Dictation | null>(null);
  const { inputDeviceId } = useAudioDevices();
  const config = getConfig();
  const canTranscribe = !!(enabled && config.stt && AudioRecorder.isSupported());

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
      audio: {
        ...(inputDeviceId && { deviceId: { exact: inputDeviceId } }),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      mimeType: "audio/webm;codecs=opus",
      onError: (error) => {
        // Start/stop failures reject their own promises; only asynchronous
        // recording failures need to notify and close the composer here.
        if (current.current?.scope !== scope || !session.recording || session.stopping) return;
        cancel();
        setIsTranscribing(false);
        notify.error("Recording stopped", error.message);
      },
    });
    const session: Dictation = { scope, recorder, recording: false };
    scope.own(recorder, (recorder) => recorder.cancel());
    scope.own(
      recorder.subscribe((state) => {
        if (state !== "idle") return;
        // A microphone can end the recording itself. Let an onError callback
        // report its detail first, then release a naturally stopped session.
        queueMicrotask(() => {
          if (current.current === session && session.recording && !session.stopping) {
            cancel();
            setIsTranscribing(false);
          }
        });
      }),
      (unsubscribe) => unsubscribe(),
    );
    current.current = session;
    setIsTranscribing(true);
    try {
      await scope.wait(recorder.start());
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
    session.stopping = Promise.resolve()
      .then(() => transcribe(session))
      .catch((error: unknown) => {
        if (session.scope.signal.aborted) return "";
        throw error;
      })
      .finally(async () => {
        if (current.current === session) current.current = null;
        await session.scope.close();
      });
    return session.stopping;
  }, [cancel]);

  return { canTranscribe, isTranscribing, startTranscription, stopTranscription };
}
