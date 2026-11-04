import { History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { renderExport } from "../../lib/exportImage";
import { loadVersionBlob } from "../../lib/imageStorage";
import { isDefaultRecipe, recipeEquals, type Adjustments } from "../../lib/recipe";
import { versionRecipe } from "../../lib/versions";
import type { Image, ImageVersion } from "../../types/canvas";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/formatRelativeTime";
import { flushPersistence } from "@/shared/lib/persistence";
import { notify } from "@/shared/lib/notify";
import { PanelSection } from "../Inspector";

const KIND_LABEL: Record<ImageVersion["kind"], string> = {
  generated: "Generated",
  upload: "Opened photo",
  edit: "AI retouch",
  flatten: "Flattened adjustments",
};
const CURRENT = "@current";

interface VersionsPanelProps {
  image: Image;
  recipe: Adjustments;
  previewId: string | null;
  loadingId: string | null;
  onPreview: (versionId: string | null) => void;
  onRestore: (versionId: string) => void;
  onDelete: (versionId: string) => void;
  disabled?: boolean;
}

/** Live edits plus immutable pixel checkpoints. Preview never changes the image. */
export function VersionsPanel({
  image,
  recipe,
  previewId,
  loadingId,
  onPreview,
  onRestore,
  onDelete,
  disabled,
}: VersionsPanelProps) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const currentId = image.versions.at(-1)?.id;

  useEffect(() => {
    let cancelled = false;
    const owned: string[] = [];
    setThumbnails({});
    // Render sequentially: opening a long history must not exhaust WebGL contexts.
    void (async () => {
      await flushPersistence();
      const entries = [
        { key: CURRENT, id: currentId, recipe },
        ...[...image.versions]
          .reverse()
          .map((version) => ({ key: version.id, id: version.id, recipe: versionRecipe(version) })),
      ];
      for (const entry of entries) {
        if (cancelled || !entry.id) break;
        const source = await loadVersionBlob(image, entry.id);
        if (!source) continue;
        const blob = isDefaultRecipe(entry.recipe)
          ? source
          : await renderExport(source, entry.recipe, "png", { maxEdge: 160 });
        if (cancelled) break;
        const url = URL.createObjectURL(blob);
        owned.push(url);
        setThumbnails((current) => ({ ...current, [entry.key]: url }));
      }
    })().catch((error: unknown) => {
      if (!cancelled) notify.error("Couldn't load version previews", error);
    });
    return () => {
      cancelled = true;
      for (const url of owned) URL.revokeObjectURL(url);
    };
  }, [image, recipe, currentId]);

  const thumbnail = (key: string, loading = false) => (
    <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
      {loading ? (
        <div className="flex size-full items-center justify-center text-neutral-400">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : thumbnails[key] ? (
        <img src={thumbnails[key]} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex size-full items-center justify-center text-neutral-400">
          <History size={16} />
        </div>
      )}
    </div>
  );
  const rowClass = (selected: boolean) =>
    cn(
      "rounded-xl border p-2",
      selected
        ? "border-blue-400/60 bg-blue-50/60 dark:border-blue-500/50 dark:bg-blue-950/30"
        : "border-neutral-200/70 dark:border-neutral-700/70",
    );

  return (
    <PanelSection>
      <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Select a version to preview it. Current keeps your live edits until you restore a saved version.
      </p>
      <ol className="space-y-2">
        <li className={rowClass(previewId === null && !loadingId)}>
          <button
            type="button"
            aria-label="Preview Current"
            aria-pressed={previewId === null && !loadingId}
            disabled={disabled}
            onClick={() => onPreview(null)}
            className="flex w-full items-center gap-3 rounded-md text-left disabled:opacity-40"
          >
            {thumbnail(CURRENT)}
            <span className="min-w-0">
              <span className="block text-xs font-medium text-neutral-800 dark:text-neutral-100">Current</span>
              <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">Your live edits</span>
            </span>
          </button>
        </li>
        {[...image.versions].reverse().map((version) => {
          const currentPixels = version.id === currentId;
          const canRestore = !currentPixels || !recipeEquals(recipe, versionRecipe(version));
          return (
            <li key={version.id} className={rowClass(previewId === version.id)}>
              <button
                type="button"
                aria-label={`Preview ${KIND_LABEL[version.kind]}`}
                aria-pressed={previewId === version.id}
                disabled={disabled}
                onClick={() => onPreview(version.id)}
                className="flex w-full gap-3 rounded-md text-left disabled:opacity-40"
              >
                {thumbnail(version.id, loadingId === version.id)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">
                    {KIND_LABEL[version.kind]}
                  </span>
                  <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                    {formatRelativeTime(version.created)}
                  </span>
                  {version.prompt && (
                    <span
                      className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-neutral-500 dark:text-neutral-400"
                      title={version.prompt}
                    >
                      {version.prompt}
                    </span>
                  )}
                </span>
              </button>
              {(canRestore || !currentPixels) && (
                <div className="mt-1.5 flex items-center gap-1 pl-[4.25rem]">
                  {canRestore && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRestore(version.id)}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/5 dark:hover:text-white"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                  )}
                  {!currentPixels && (
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label="Delete version"
                      onClick={() => onDelete(version.id)}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </PanelSection>
  );
}
