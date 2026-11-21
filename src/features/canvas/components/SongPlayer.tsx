import { Download, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { exportFilename } from "../lib/exportImage";
import { formatTime, songColors, WAVEFORM_BARS } from "../lib/song";
import type { Image } from "../types/canvas";
import { useSwipe, type SwipeDirection } from "../hooks/useSwipe";
import { cn } from "@/shared/lib/cn";
import { modelName } from "@/shared/lib/models";
import { notify } from "@/shared/lib/notify";
import { downloadBlob } from "@/shared/lib/utils";
import { StageToolbar, TOOLBAR_BUTTON_CLASS } from "./Stage";

/** Stands in for an unknown waveform: an even line that still works as a seek bar. */
const FLAT_BARS = Array.from({ length: WAVEFORM_BARS }, () => 0);
/** Seconds per arrow key. */
const SEEK_STEP = 5;

interface SongPlayerProps {
  image: Image;
  /** Phones: swipe across the stage steps to the previous/next item. */
  onSwipe?: (direction: SwipeDirection) => void;
}

/**
 * Plays a generated song: its waveform is the seek bar, and the prompt it was
 * made from (with any lyrics) sits underneath. Download keeps the MP3 as generated.
 */
export function SongPlayer({ image, onSwipe }: SongPlayerProps) {
  const swipe = useSwipe(onSwipe);
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [measured, setMeasured] = useState<number>();

  useEffect(() => {
    if (!image.blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(image.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image.blob]);

  // The decoded length is exact; the element may only estimate an MP3's.
  const duration = image.duration ?? measured;
  const progress = duration ? Math.min(1, time / duration) : 0;
  const label = image.title || image.prompt || "Song";
  const [from, to] = songColors(image.prompt);
  const bars = image.peaks?.length ? image.peaks : FLAT_BARS;

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) element.play().catch((error: unknown) => notify.error("Playback failed", error));
    else element.pause();
  };

  const seekTo = (seconds: number) => {
    const element = audio.current;
    if (!element || !duration) return;
    const target = Math.min(Math.max(0, seconds), duration);
    element.currentTime = target;
    setTime(target);
  };

  const seekToPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (duration && bounds.width) seekTo(((event.clientX - bounds.left) / bounds.width) * duration);
  };

  const onSeekKey = (event: KeyboardEvent) => {
    const targets: Record<string, number> = {
      ArrowLeft: time - SEEK_STEP,
      ArrowRight: time + SEEK_STEP,
      Home: 0,
      End: duration ?? 0,
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    seekTo(targets[event.key]);
  };

  const download = () => {
    if (!image.blob) return;
    downloadBlob(image.blob, exportFilename(image.title || image.prompt, "mp3")).catch((error: unknown) =>
      notify.error("Download failed", error),
    );
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 pb-16" {...swipe}>
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl shadow-black/10 ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
        <div
          className="relative shrink-0 px-5 pt-12 pb-5 text-white"
          style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
        >
          <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/30 px-2 py-1 text-xs font-medium backdrop-blur-sm">
            Song
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration ?? 0)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
            onKeyDown={onSeekKey}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              seekToPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) seekToPointer(event);
            }}
            // Dragging along the waveform seeks; it must not also page to the next item.
            onTouchStart={(event) => event.stopPropagation()}
            className="flex h-24 cursor-pointer touch-none items-center gap-0.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/70"
          >
            {bars.map((peak, index) => (
              <span
                // The bars are positional and never reorder.
                key={index}
                className={cn(
                  "min-w-0 flex-1 rounded-full bg-white",
                  (index + 0.5) / bars.length <= progress ? "opacity-100" : "opacity-40",
                )}
                style={{ height: `${Math.max(4, peak * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              disabled={!url}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
              className="press flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-neutral-900 shadow-sm disabled:opacity-50"
            >
              {playing ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" className="translate-x-px" />
              )}
            </button>
            <span className="text-sm tabular-nums">
              {formatTime(time)} / {formatTime(duration)}
            </span>
            {image.model && <span className="ml-auto truncate text-xs text-white/80">{modelName(image.model)}</span>}
          </div>
        </div>
        {image.prompt && (
          <p className="min-h-0 overflow-y-auto px-5 py-4 text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
            {image.prompt}
          </p>
        )}
      </div>
      {/* No captions exist for generated music; the lyrics, when given, are the prompt above. */}
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => {
          const next = event.currentTarget.duration;
          if (Number.isFinite(next)) setMeasured(next);
        }}
      />
      <StageToolbar>
        <button
          type="button"
          className={TOOLBAR_BUTTON_CLASS}
          onClick={download}
          disabled={!image.blob}
          title="Download MP3"
          aria-label="Download"
        >
          <Download size={18} />
        </button>
      </StageToolbar>
    </div>
  );
}
