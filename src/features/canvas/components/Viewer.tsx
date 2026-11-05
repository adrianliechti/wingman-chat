import { Download, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { exportFilename } from "../lib/exportImage";
import { viewOnlyFormat } from "../lib/images";
import type { Image } from "../types/canvas";
import { cn } from "@/shared/lib/cn";
import { notify } from "@/shared/lib/notify";
import { decodeDataURL, downloadBlob } from "@/shared/lib/utils";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { NAV_BUTTON_CLASS } from "./Editor";
import { CHECKER } from "./Stage";

const LABELS = { svg: "SVG", gif: "Animated GIF" } as const;

/** The image's own shape scaled into the stage; null (fill the stage) while either is unknown. */
function fitInto(available: [number, number] | null, width?: number, height?: number) {
  if (!available || !width || !height) return null;
  const fit = Math.min(available[0] / width, available[1] / height);
  return { width: Math.max(1, Math.floor(width * fit)), height: Math.max(1, Math.floor(height * fit)) };
}

interface ViewerProps {
  image: Image;
  onNew: () => void;
}

/**
 * Shows a vector or animated image as it is, with download in its own format.
 * The photo editor's adjustments would rasterize an SVG and freeze a GIF.
 */
export function Viewer({ image, onNew }: ViewerProps) {
  const { setRightActions } = useNavigation();
  const stage = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<[number, number] | null>(null);
  const format = viewOnlyFormat(image.data);
  const alt = image.title || image.prompt || "Image";

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailable([Math.max(1, entry.contentRect.width - 32), Math.max(1, entry.contentRect.height - 32)]);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const download = useCallback(() => {
    downloadBlob(decodeDataURL(image.data), exportFilename(image.title || image.prompt, format ?? "png")).catch(
      (error: unknown) => notify.error("Download failed", error),
    );
  }, [image.data, image.title, image.prompt, format]);

  useEffect(() => {
    setRightActions(
      <>
        <button type="button" className={NAV_BUTTON_CLASS} onClick={onNew} title="New image" aria-label="New image">
          <PlusIcon size={20} />
        </button>
        <button
          type="button"
          className={NAV_BUTTON_CLASS}
          onClick={download}
          title={`Download ${format ? format.toUpperCase() : "image"}`}
          aria-label="Download"
        >
          <Download size={20} />
        </button>
      </>,
    );
    return () => setRightActions(null);
  }, [setRightActions, onNew, download, format]);

  const size = fitInto(available, image.width, image.height);

  return (
    <div ref={stage} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-4">
      <div
        className={cn("relative overflow-hidden rounded-lg shadow-xl shadow-black/10", CHECKER, !size && "size-full")}
        style={size ?? undefined}
      >
        <img src={image.data} alt={alt} className="block size-full object-contain" draggable={false} />
        {format && (
          <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {LABELS[format]}
          </div>
        )}
      </div>
    </div>
  );
}
