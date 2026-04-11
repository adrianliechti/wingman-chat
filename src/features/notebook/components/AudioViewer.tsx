import { useRef, useState, useEffect, useMemo } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";

interface AudioViewerProps {
  content: string;
  audioUrl: string;
}

function createTranscriptTrack(content: string): string {
  const text = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return `WEBVTT\n\n1\n00:00:00.000 --> 99:59:59.000\n${text || "Transcript unavailable."}\n`;
}

export function AudioViewer({ content, audioUrl }: AudioViewerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const transcriptTrackUrl = useMemo(
    () => URL.createObjectURL(new Blob([createTranscriptTrack(content)], { type: "text/vtt" })),
    [content],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(transcriptTrackUrl);
    };
  }, [transcriptTrackUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  const restart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play();
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="h-full flex flex-col relative">
      <audio ref={audioRef} src={audioUrl} preload="metadata">
        <track kind="captions" src={transcriptTrackUrl} srcLang="en" label="Transcript" default />
      </audio>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-6 pb-24 min-h-0">
        <Transcript content={content} />
      </div>

      {/* Floating audio player */}
      <div className="absolute bottom-4 left-4 right-4 z-10">
        <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
          {/* Play/pause */}
          <button
            type="button"
            onClick={togglePlay}
            className="shrink-0 w-9 h-9 rounded-full bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 flex items-center justify-center hover:opacity-80 transition-opacity"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>

          {/* Progress */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-[11px] text-neutral-500 tabular-nums shrink-0 w-8 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={currentTime}
              onChange={seek}
              className="flex-1 h-1 appearance-none bg-neutral-200 dark:bg-neutral-700 rounded-full outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-800 dark:[&::-webkit-slider-thumb]:bg-neutral-200"
            />
            <span className="text-[11px] text-neutral-500 tabular-nums shrink-0 w-8">{formatTime(duration)}</span>
          </div>

          {/* Restart */}
          <button
            type="button"
            onClick={restart}
            className="shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Transcript with host tag formatting ────────────────────────────────

interface TranscriptBlock {
  speaker: string | null;
  text: string;
}

function parseTranscript(content: string): TranscriptBlock[] {
  const lines = content.split("\n");
  const blocks: TranscriptBlock[] = [];

  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (text) {
      blocks.push({ speaker: currentSpeaker, text });
    }
    currentLines = [];
  };

  // Known speaker names to avoid false positives on the loose pattern
  const knownSpeakers = new Set<string>();

  // First pass: find bracketed speakers like [Host 1]
  for (const line of lines) {
    const bracketMatch = line.match(/^\*{0,2}\[([^\]]+)\]/);
    if (bracketMatch) {
      knownSpeakers.add(bracketMatch[1].toLowerCase());
    }
  }

  for (const line of lines) {
    // Try bracketed format first: [Speaker] or **[Speaker]:**
    const bracketMatch = line.match(/^\*{0,2}\[([^\]]+)\]:?\*{0,2}:?\s*/);
    if (bracketMatch) {
      flush();
      currentSpeaker = bracketMatch[1];
      const rest = line.slice(bracketMatch[0].length);
      if (rest.trim()) currentLines.push(rest);
      continue;
    }

    // Try bold format: **Host 1:** (only if we've seen bracketed speakers)
    if (knownSpeakers.size > 0) {
      const boldMatch = line.match(/^\*\*([^*]+)\*\*:?\s*/);
      if (boldMatch && knownSpeakers.has(boldMatch[1].toLowerCase())) {
        flush();
        currentSpeaker = boldMatch[1];
        const rest = line.slice(boldMatch[0].length);
        if (rest.trim()) currentLines.push(rest);
        continue;
      }
    }

    currentLines.push(line);
  }
  flush();

  return blocks;
}

function Transcript({ content }: { content: string }) {
  const blocks = useMemo(() => parseTranscript(content), [content]);
  const hasHosts = blocks.some((b) => b.speaker);
  const keyedBlocks = useMemo(() => {
    const counts = new Map<string, number>();

    return blocks.map((block) => {
      const baseKey = `${block.speaker ?? "transcript"}:${block.text.slice(0, 80)}`;
      const occurrence = (counts.get(baseKey) ?? 0) + 1;
      counts.set(baseKey, occurrence);
      return { block, key: `${baseKey}:${occurrence}` };
    });
  }, [blocks]);

  if (!hasHosts) {
    return (
      <div className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {keyedBlocks.map(({ block, key }) => (
        <div key={key}>
          {block.speaker && (
            <p className="text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-1.5">
              {block.speaker}
            </p>
          )}
          <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">
            {block.text}
          </p>
        </div>
      ))}
    </div>
  );
}
