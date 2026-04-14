import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder } from "@/features/voice/lib/AudioRecorder";
import { mergePcm16Chunks, pcm16ToWav } from "@/features/voice/lib/audio";
import { getConfig } from "@/shared/config";
import { blobToDataUrl } from "@/shared/lib/opfs-core";

interface FieldRecorderOptions {
  chunkDurationSec?: number;
}

export interface FieldRecorderResult {
  transcript: string;
  audioUrl: string;
}

export interface UseFieldRecorderReturn {
  canRecord: boolean;
  isRecording: boolean;
  elapsedSec: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<FieldRecorderResult>;
}

const SAMPLE_RATE = 24000;

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useFieldRecorder(options: FieldRecorderOptions = {}): UseFieldRecorderReturn {
  const chunkDurationSec = options.chunkDurationSec ?? 120;

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-chunk accumulation (for transcription)
  const currentChunkRef = useRef<Int16Array[]>([]);
  const currentChunkSamplesRef = useRef(0);
  const chunkIndexRef = useRef(0);
  // Full recording accumulation (for audio export)
  const allSamplesRef = useRef<Int16Array[]>([]);
  const transcriptsRef = useRef<Map<number, { startSec: number; endSec: number; text: string }>>(new Map());
  const inflightRef = useRef<Set<Promise<void>>>(new Set());
  const startTimeRef = useRef(0);

  const config = getConfig();
  const canRecord =
    !!config.stt &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";

  const transcribeChunk = useCallback((pcmChunks: Int16Array[], index: number, startSec: number, endSec: number) => {
    const merged = mergePcm16Chunks(pcmChunks);
    const wav = pcm16ToWav(merged, SAMPLE_RATE);

    const config = getConfig();
    const model = config.stt?.model ?? "";

    const promise = config.client
      .transcribe(model, wav)
      .then((text) => {
        transcriptsRef.current.set(index, { startSec, endSec, text });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        transcriptsRef.current.set(index, {
          startSec,
          endSec,
          text: `(transcription failed: ${msg})`,
        });
      })
      .finally(() => {
        inflightRef.current.delete(promise);
      });

    inflightRef.current.add(promise);
  }, []);

  const flushChunk = useCallback(() => {
    const chunks = currentChunkRef.current;
    if (chunks.length === 0) return;

    const index = chunkIndexRef.current;
    const startSec = index * chunkDurationSec;
    const sampleCount = currentChunkSamplesRef.current;
    const endSec = startSec + sampleCount / SAMPLE_RATE;

    const snapshot = [...chunks];
    currentChunkRef.current = [];
    currentChunkSamplesRef.current = 0;
    chunkIndexRef.current = index + 1;

    transcribeChunk(snapshot, index, startSec, endSec);
  }, [chunkDurationSec, transcribeChunk]);

  const start = useCallback(async () => {
    if (!canRecord) throw new Error("Recording is not available");

    setError(null);
    setElapsedSec(0);
    currentChunkRef.current = [];
    currentChunkSamplesRef.current = 0;
    chunkIndexRef.current = 0;
    allSamplesRef.current = [];
    transcriptsRef.current = new Map();
    inflightRef.current = new Set();

    const recorder = new AudioRecorder({ sampleRate: SAMPLE_RATE });
    await recorder.begin();

    const chunkThreshold = chunkDurationSec * SAMPLE_RATE;

    await recorder.record((chunk) => {
      const samples = new Int16Array(chunk.mono);
      // Accumulate for full audio export
      allSamplesRef.current.push(samples);
      // Accumulate for current transcription chunk
      currentChunkRef.current.push(samples);
      currentChunkSamplesRef.current += samples.length;

      if (currentChunkSamplesRef.current >= chunkThreshold) {
        flushChunk();
      }
    });

    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setIsRecording(true);

    if (navigator.wakeLock) {
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          wakeLockRef.current = lock;
        })
        .catch(() => {});
    }

    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [canRecord, chunkDurationSec, flushChunk]);

  const stop = useCallback(async (): Promise<FieldRecorderResult> => {
    const recorder = recorderRef.current;
    if (!recorder) throw new Error("No active recording");

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    await recorder.end();
    recorderRef.current = null;
    setIsRecording(false);

    if (wakeLockRef.current) {
      await wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }

    // Flush remaining samples for transcription
    if (currentChunkRef.current.length > 0) {
      flushChunk();
    }

    // Build full WAV from all samples
    const allMerged = mergePcm16Chunks(allSamplesRef.current);
    const fullWav = pcm16ToWav(allMerged, SAMPLE_RATE);
    const audioUrl = await blobToDataUrl(fullWav);
    allSamplesRef.current = [];

    // Wait for all in-flight transcriptions
    if (inflightRef.current.size > 0) {
      await Promise.all([...inflightRef.current]);
    }

    // Assemble combined transcript
    const transcripts = transcriptsRef.current;
    const indices = [...transcripts.keys()].sort((a, b) => a - b);

    let transcript: string;
    if (indices.length === 0) {
      transcript = "(no audio recorded)";
    } else if (indices.length === 1) {
      const entry = transcripts.get(indices[0]);
      transcript = entry?.text ?? "";
    } else {
      transcript = indices
        .map((i) => {
          const t = transcripts.get(i);
          if (!t) return "";
          return `[${formatTimestamp(t.startSec)} - ${formatTimestamp(t.endSec)}]\n${t.text}`;
        })
        .join("\n\n");
    }

    return { transcript, audioUrl };
  }, [flushChunk]);

  // Force-release all resources (mic, wake lock, timer)
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.end().catch(() => {});
      recorderRef.current = null;
    }
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  // Release mic on unmount
  useEffect(() => cleanup, [cleanup]);

  return {
    canRecord,
    isRecording,
    elapsedSec,
    error,
    start,
    stop,
  };
}
