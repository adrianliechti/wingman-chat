import { AlertCircle, FolderOpen, Images, Loader2, PanelRightOpen, PlusIcon, RotateCw, X } from "lucide-react";
import { viewOnlyFormat } from "../lib/images";
import type { Image, PendingGeneration } from "../types/canvas";
import { cn } from "@/shared/lib/cn";
import { useSidebar } from "@/shell/hooks/useSidebar";

interface CanvasSidebarProps {
  images: Image[];
  pending: PendingGeneration[];
  selectedId: string | null;
  isLoaded: boolean;
  /** Photos are being decoded and stored; the open button shows a spinner. */
  importing?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDismissPending: (id: string) => void;
  onRetryPending: (id: string) => void;
  onNew: () => void;
  onOpenPhoto: () => void;
}

const HEADER_BUTTON_CLASS =
  "rounded p-2 text-neutral-600 transition-all duration-200 hover:bg-neutral-200/60 hover:text-neutral-800 disabled:opacity-50 md:p-1.5 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-200";

const TILE_BUTTON_CLASS =
  "flex size-7 items-center justify-center rounded-full bg-neutral-900/70 text-white shadow-sm transition-colors hover:bg-neutral-900 dark:bg-neutral-100/80 dark:text-neutral-900 dark:hover:bg-white";

/**
 * The image library as a two-column grid, for the phone drawer where the
 * filmstrip has no room. Tapping a tile opens it and closes the drawer.
 */
export function CanvasSidebar({
  images,
  pending,
  selectedId,
  isLoaded,
  importing = false,
  onSelect,
  onDelete,
  onDismissPending,
  onRetryPending,
  onNew,
  onOpenPhoto,
}: CanvasSidebarProps) {
  const { setShowSidebar } = useSidebar();

  const closeOnMobile = () => {
    if (window.innerWidth < 768) setShowSidebar(false);
  };
  const select = (id: string) => {
    onSelect(id);
    closeOnMobile();
  };

  const empty = isLoaded && images.length === 0 && pending.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2 max-md:border-0 max-md:px-3 md:h-[3.6875rem] md:px-1.5 md:py-1 dark:border-neutral-800">
        <span className="px-2 text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">Images</span>
        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-1">
          <button
            type="button"
            onClick={() => {
              onNew();
              closeOnMobile();
            }}
            className={HEADER_BUTTON_CLASS}
            aria-label="New creation"
            title="New creation"
          >
            <PlusIcon size={20} />
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenPhoto();
              closeOnMobile();
            }}
            disabled={importing}
            className={HEADER_BUTTON_CLASS}
            aria-label="Open photo"
            title="Open photo"
          >
            {importing ? <Loader2 size={20} className="animate-spin" /> : <FolderOpen size={20} />}
          </button>
          <button
            type="button"
            onClick={() => setShowSidebar(false)}
            className={cn(
              HEADER_BUTTON_CLASS,
              "max-md:press max-md:flex max-md:size-10 max-md:items-center max-md:justify-center max-md:rounded-full max-md:bg-black/6 max-md:p-0 max-md:text-neutral-800 max-md:dark:bg-white/10 max-md:dark:text-neutral-100",
            )}
            aria-label="Close sidebar"
          >
            <PanelRightOpen size={20} className="hidden md:block" />
            <X size={20} className="md:hidden" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:px-2">
        {empty && (
          <div className="flex flex-col items-center gap-2 px-4 pt-16 text-center">
            <Images size={22} className="text-neutral-300 dark:text-neutral-600" />
            <p className="text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
              Images and videos you create or open are kept here.
            </p>
          </div>
        )}

        <div role="listbox" aria-label="Images and videos" className="grid grid-cols-2 gap-2 pt-1">
          {pending.map((item) => {
            const active = item.id === selectedId;
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={active}
                aria-label={item.status === "error" ? "Failed generation" : "Generating media"}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-xl",
                  active ? "ring-2 ring-blue-500 dark:ring-blue-400" : "ring-1 ring-black/8 dark:ring-white/10",
                )}
              >
                <button
                  type="button"
                  onClick={() => select(item.id)}
                  title={item.prompt}
                  className={cn(
                    "press flex size-full items-center justify-center",
                    item.status === "running"
                      ? "animate-pulse bg-neutral-200 dark:bg-neutral-800"
                      : "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400",
                  )}
                >
                  {item.status === "error" && <AlertCircle size={22} />}
                </button>
                {item.status === "error" && (
                  <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-black/40 p-1.5">
                    <button
                      type="button"
                      aria-label="Retry generation"
                      title="Retry"
                      onClick={() => onRetryPending(item.id)}
                      className={TILE_BUTTON_CLASS}
                    >
                      <RotateCw size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Dismiss failed generation"
                      title="Dismiss"
                      onClick={() => onDismissPending(item.id)}
                      className={TILE_BUTTON_CLASS}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {images.map((image) => {
            const active = image.id === selectedId;
            const format = viewOnlyFormat(image.data, image.contentType);
            const label = image.title || image.prompt || "Image";
            return (
              <div
                key={image.id}
                role="option"
                aria-selected={active}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-xl bg-neutral-200/60 dark:bg-neutral-800/60",
                  active ? "ring-2 ring-blue-500 dark:ring-blue-400" : "ring-1 ring-black/8 dark:ring-white/10",
                )}
              >
                <button type="button" onClick={() => select(image.id)} title={label} className="press block size-full">
                  <img src={image.data} alt={label} className="size-full object-cover" draggable={false} />
                </button>
                {format && (
                  <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1 text-[9px] leading-4 font-semibold text-white uppercase">
                    {format}
                  </span>
                )}
                {/* Always visible: there is no hover on the phones this grid is for. */}
                <button
                  type="button"
                  aria-label={format === "mp4" ? "Delete video" : "Delete image"}
                  title="Delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(image.id);
                  }}
                  className={cn(TILE_BUTTON_CLASS, "absolute top-1.5 right-1.5 size-6")}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
