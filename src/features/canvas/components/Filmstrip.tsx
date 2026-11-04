import { AlertCircle, PlusIcon, RotateCw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Image } from "../types/canvas";
import { cn } from "@/shared/lib/cn";

/** A generation in flight (or failed), shown as a placeholder tile. */
export interface PendingGeneration {
  id: string;
  prompt: string;
  /** Width / height when the request asked for a specific aspect. */
  aspect: number | null;
  status: "running" | "error";
  error?: string;
}

interface FilmstripProps {
  images: Image[];
  pending: PendingGeneration[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDismissPending: (id: string) => void;
  onRetryPending: (id: string) => void;
  onNew: () => void;
}

const tileAspect = (width?: number, height?: number) => (width && height ? `${width} / ${height}` : "1 / 1");

export function Filmstrip({
  images,
  pending,
  selectedId,
  onSelect,
  onDelete,
  onDismissPending,
  onRetryPending,
  onNew,
}: FilmstripProps) {
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    strip.current
      ?.querySelector(`[data-id="${selectedId}"]`)
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div
      ref={strip}
      role="listbox"
      aria-label="Images"
      className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-neutral-200/70 bg-white/50 px-3 backdrop-blur-xl dark:border-neutral-800/70 dark:bg-neutral-900/50"
    >
      <button
        type="button"
        onClick={onNew}
        title="New image"
        aria-label="New image"
        className="flex size-16 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 dark:border-neutral-600 dark:text-neutral-500 dark:hover:border-neutral-500 dark:hover:text-neutral-300"
      >
        <PlusIcon size={20} />
      </button>

      {pending.map((item) => {
        const active = item.id === selectedId;
        return (
          <div
            key={item.id}
            data-id={item.id}
            role="option"
            aria-selected={active}
            aria-label={item.status === "error" ? "Failed generation" : "Generating image"}
            className={cn(
              "group relative h-16 shrink-0 overflow-hidden rounded-xl",
              active ? "ring-2 ring-blue-500 dark:ring-blue-400" : "ring-1 ring-neutral-200 dark:ring-neutral-700",
            )}
            style={{ aspectRatio: item.aspect ?? 1 }}
          >
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              title={item.prompt}
              className={cn(
                "flex size-full items-center justify-center",
                item.status === "running"
                  ? "animate-pulse bg-neutral-200 dark:bg-neutral-800"
                  : "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400",
              )}
            >
              {item.status === "error" && <AlertCircle size={18} />}
            </button>
            {item.status === "error" && (
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/50 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="Retry generation"
                  title="Retry"
                  onClick={() => onRetryPending(item.id)}
                  className="rounded p-0.5 text-white hover:bg-white/20"
                >
                  <RotateCw size={12} />
                </button>
                <button
                  type="button"
                  aria-label="Dismiss failed generation"
                  title="Dismiss"
                  onClick={() => onDismissPending(item.id)}
                  className="rounded p-0.5 text-white hover:bg-white/20"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {images.map((image) => {
        const active = image.id === selectedId;
        return (
          <div
            key={image.id}
            data-id={image.id}
            role="option"
            aria-selected={active}
            className={cn(
              "group relative h-16 shrink-0 overflow-hidden rounded-xl transition-shadow",
              active
                ? "ring-2 ring-blue-500 shadow-md dark:ring-blue-400"
                : "ring-1 ring-neutral-200 hover:ring-neutral-400 dark:ring-neutral-700 dark:hover:ring-neutral-500",
            )}
            style={{ aspectRatio: tileAspect(image.width, image.height) }}
          >
            <button
              type="button"
              onClick={() => onSelect(image.id)}
              title={image.title || image.prompt || "Image"}
              className="block size-full"
            >
              <img
                src={image.data}
                alt={image.title || image.prompt || "Image"}
                className="size-full object-cover"
                draggable={false}
              />
            </button>
            <button
              type="button"
              aria-label="Delete image"
              title="Delete"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(image.id);
              }}
              className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-neutral-900/70 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-neutral-900 focus-visible:opacity-100 dark:bg-neutral-100/80 dark:text-neutral-900 dark:hover:bg-white"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
