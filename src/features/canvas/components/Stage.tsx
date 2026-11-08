import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { outputSize } from "../lib/geometry";
import type { Adjustments } from "../lib/recipe";
import type { RendererHandle } from "../hooks/useRenderer";
import { useSwipe, type SwipeDirection } from "../hooks/useSwipe";
import { cn } from "@/shared/lib/cn";

interface StageProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  renderer: RendererHandle;
  recipe: Adjustments;
  /** Data URL for the WebGL-less fallback and the pre-render placeholder. */
  fallbackSrc: string;
  alt: string;
  /** Shown while a before/after compare is active. */
  badge?: ReactNode;
  /** Overlays (crop handles, selection) positioned over the image surface. */
  children?: ReactNode;
  className?: string;
  /** Horizontal swipe across the stage; phones use it to step through the library. */
  onSwipe?: (direction: SwipeDirection) => void;
  /** Floating controls along the stage's bottom edge (see StageToolbar). */
  toolbar?: ReactNode;
}

/** Checkerboard behind transparent pixels. */
export const CHECKER =
  "bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-[image:linear-gradient(45deg,var(--checker)_25%,transparent_25%,transparent_75%,var(--checker)_75%),linear-gradient(45deg,var(--checker)_25%,transparent_25%,transparent_75%,var(--checker)_75%)] [--checker:rgb(0_0_0/0.08)] dark:[--checker:rgb(255_255_255/0.08)]";

/**
 * Fits the rendered image into the available space. The canvas keeps its
 * output pixel size (set by the renderer); CSS scales it to the surface.
 */
export function Stage({
  canvasRef,
  renderer,
  recipe,
  fallbackSrc,
  alt,
  badge,
  children,
  className,
  onSwipe,
  toolbar,
}: StageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<[number, number]>([1, 1]);
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const swipe = useSwipe(onSwipe);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailable([Math.max(1, entry.contentRect.width - 32), Math.max(1, entry.contentRect.height - 32)]);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Without a renderer (or before it is ready) size the surface from the image itself.
  useEffect(() => {
    if (renderer.size.width) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setNatural([image.naturalWidth, image.naturalHeight]);
    };
    image.src = fallbackSrc;
    return () => {
      cancelled = true;
    };
  }, [fallbackSrc, renderer.size.width]);

  const source: [number, number] = renderer.size.width
    ? [renderer.size.width, renderer.size.height]
    : (natural ?? [3, 2]);
  const [outWidth, outHeight] = outputSize(recipe.geometry, source[0], source[1]);
  const fit = Math.min(available[0] / outWidth, available[1] / outHeight);
  const width = Math.max(1, Math.floor(outWidth * fit));
  const height = Math.max(1, Math.floor(outHeight * fit));
  const showFallback = renderer.status === "unsupported" || renderer.status === "error";
  const busy = renderer.status === "loading" || renderer.status === "idle";

  return (
    <div
      ref={stage}
      className={cn("relative flex min-h-0 min-w-0 flex-1 items-center justify-center", className)}
      {...swipe}
    >
      <div
        className={cn("relative overflow-hidden rounded-lg shadow-xl shadow-black/10", CHECKER)}
        style={{ width, height }}
      >
        {showFallback && (
          <img src={fallbackSrc} alt={alt} className="block size-full object-contain" draggable={false} />
        )}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={alt}
          className={cn(
            "size-full transition-opacity duration-200",
            showFallback ? "hidden" : "block",
            busy ? "opacity-0" : "opacity-100",
          )}
        />
        {busy && !showFallback && (
          <img
            src={fallbackSrc}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 block size-full object-contain"
            draggable={false}
          />
        )}
        {children}
      </div>
      {toolbar}
      {badge && (
        <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {badge}
        </div>
      )}
      {renderer.status === "loading" && (
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur-sm",
            toolbar ? "bottom-16" : "bottom-3",
          )}
        >
          <Loader2 size={12} className="animate-spin" />
          Preparing…
        </div>
      )}
      {showFallback && (
        <div
          role="alert"
          className={cn(
            "pointer-events-none absolute left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur-sm",
            toolbar ? "bottom-16" : "bottom-3",
          )}
        >
          {renderer.status === "unsupported"
            ? "Editing needs WebGL2, which this browser lacks"
            : `Preview unavailable${renderer.error ? `: ${renderer.error}` : ""}`}
        </div>
      )}
    </div>
  );
}

// Buttons in the stage toolbar; the pressed state matches the agent button in the chat top bar.
export const TOOLBAR_BUTTON_CLASS =
  "press flex size-9 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-black/5 disabled:pointer-events-none disabled:opacity-30 dark:text-neutral-200 dark:hover:bg-white/10";
export const TOOLBAR_ACTIVE_CLASS = "bg-neutral-200 text-neutral-900 dark:bg-neutral-700/60 dark:text-neutral-100";

/**
 * Glass pill floating over the bottom of the stage for the image's own controls,
 * so the app's top bar keeps only "New", as on the chat and translate pages.
 */
export function StageToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="glass absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1">
      {children}
    </div>
  );
}
