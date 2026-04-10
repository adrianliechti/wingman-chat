import { useState, useCallback, useRef } from "react";
import { getConfig } from "@/shared/config";
import { AudioRecorder } from "@/features/voice/lib/AudioRecorder";
import { pcm16ToWav, mergePcm16Chunks } from "@/features/voice/lib/audio";

interface FieldRecorderOptions {
  chunkDurationSec?: number;
}

export interface UseFieldRecorderReturn {
  canRecord: boolean;
  isRecording: boolean;
  elapsedSec: number;
  chunksTotal: number;
  chunksTranscribed: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<string>;
}

const SAMPLE_RATE = 24000;

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useFieldRecorder(
  options: FieldRecorderOptions = {},
): UseFieldRecorderReturn {
  const chunkDurationSec = options.chunkDurationSec ?? 120;

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [chunksTranscribed, setChunksTranscribed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentChunkRef = useRef<Int16Array[]>([]);
  const currentChunkSamplesRef = useRef(0);
  const chunkIndexRef = useRef(0);
  const transcriptsRef = useRef<Map<number, { startSec: number; endSec: number; text: string }>>(new Map());
  const inflightRef = useRef<Set<Promise<void>>>(new Set());
  const startTimeRef = useRef(0);

  const config = getConfig();
  const canRecord =
    !!config.stt &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";

  const transcribeChunk = useCallback(
    (pcmChunks: Int16Array[], index: number, startSec: number, endSec: number) => {
      const merged = mergePcm16Chunks(pcmChunks);
      const wav = pcm16ToWav(merged, SAMPLE_RATE);

      const config = getConfig();
      const model = config.stt?.model ?? "";

      const promise = config.client
        .transcribe(model, wav)
        .then((text) => {
          transcriptsRef.current.set(index, { startSec, endSec, text });
          setChunksTranscribed((prev) => prev + 1);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          transcriptsRef.current.set(index, {
            startSec,
            endSec,
            text: `(transcription failed: ${msg})`,
          });
          setChunksTranscribed((prev) => prev + 1);
        })
        .finally(() => {
          inflightRef.current.delete(promise);
        });

      inflightRef.current.add(promise);
    },
    [],
  );

  const flushChunk = useCallback(() => {
    const chunks = currentChunkRef.current;
    if (chunks.length === 0) return;

    const index = chunkIndexRef.current;
    const startSec = index * chunkDurationSec;
    const sampleCount = currentChunkSamplesRef.current;
    const endSec = startSec + sampleCount / SAMPLE_RATE;

    // Snapshot and reset
    const snapshot = [...chunks];
    currentChunkRef.current = [];
    currentChunkSamplesRef.current = 0;
    chunkIndexRef.current = index + 1;

    setChunksTotal((prev) => prev + 1);
    transcribeChunk(snapshot, index, startSec, endSec);
  }, [chunkDurationSec, transcribeChunk]);

  const start = useCallback(async () => {
    if (!canRecord) throw new Error("Recording is not available");

    // Reset state
    setError(null);
    setElapsedSec(0);
    setChunksTotal(0);
    setChunksTranscribed(0);
    currentChunkRef.current = [];
    currentChunkSamplesRef.current = 0;
    chunkIndexRef.current = 0;
    transcriptsRef.current = new Map();
    inflightRef.current = new Set();

    const recorder = new AudioRecorder({ sampleRate: SAMPLE_RATE });
    await recorder.begin();

    const chunkThreshold = chunkDurationSec * SAMPLE_RATE;

    await recorder.record((chunk) => {
      const samples = new Int16Array(chunk.mono);
      currentChunkRef.current.push(samples);
      currentChunkSamplesRef.current += samples.length;

      if (currentChunkSamplesRef.current >= chunkThreshold) {
        flushChunk();
      }
    });

    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setIsRecording(true);

    // Keep screen awake during recording
    if (navigator.wakeLock) {
      navigator.wakeLock.request("screen").then((lock) => {
        wakeLockRef.current = lock;
      }).catch(() => {});
    }

    // Elapsed time ticker
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [canRecord, chunkDurationSec, flushChunk]);

  const stop = useCallback(async (): Promise<string> => {
    const recorder = recorderRef.current;
    if (!recorder) throw new Error("No active recording");

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop recording
    await recorder.end();
    recorderRef.current = null;
    setIsRecording(false);

    // Release wake lock
    if (wakeLockRef.current) {
      await wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }

    // Flush remaining samples
    if (currentChunkRef.current.length > 0) {
      flushChunk();
    }

    // Wait for all in-flight transcriptions
    if (inflightRef.current.size > 0) {
      await Promise.all([...inflightRef.current]);
    }

    // Assemble combined transcript
    const transcripts = transcriptsRef.current;
    const indices = [...transcripts.keys()].sort((a, b) => a - b);

    if (indices.length === 0) {
      return "(no audio recorded)";
    }

    const parts = indices.map((i) => {
      const t = transcripts.get(i)!;
      return `[${formatTimestamp(t.startSec)} - ${formatTimestamp(t.endSec)}]\n${t.text}`;
    });

    return parts.join("\n\n");
  }, [flushChunk]);

  return {
    canRecord,
    isRecording,
    elapsedSec,
    chunksTotal,
    chunksTranscribed,
    error,
    start,
    stop,
  };
}
