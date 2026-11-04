import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { decodeBitmap, PREVIEW_MAX_EDGE } from "../lib/exportImage";
import { ImageRenderer, supportsWebGL2, type DrawOptions } from "../lib/gl/renderer";
import type { Adjustments } from "../lib/recipe";
import { decodeDataURL } from "@/shared/lib/utils";

export type RendererStatus = "idle" | "loading" | "ready" | "unsupported" | "error";

export interface RendererHandle {
  status: RendererStatus;
  /** Why the renderer is in the "error" state, for the stage notice. */
  error: string | null;
  /** Source (preview) size in pixels once ready. */
  size: { width: number; height: number };
  /** Schedule a redraw for the next animation frame; the last call per frame wins. */
  draw: (recipe: Adjustments, options?: DrawOptions) => void;
}

async function prepare(
  canvas: HTMLCanvasElement,
  data: string,
  maxEdge: number,
  onLost: () => void,
): Promise<ImageRenderer> {
  const bitmap = await decodeBitmap(decodeDataURL(data), maxEdge);
  const renderer = new ImageRenderer(canvas, { onContextLost: onLost });
  renderer.setSource(bitmap);
  bitmap.close();
  return renderer;
}

/**
 * Owns an `ImageRenderer` for the canvas in `canvasRef`, fed by `data` (a data
 * URL). The preview texture is downscaled to `maxEdge`; `renderExport` renders
 * the full resolution separately.
 */
export function useRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  data: string | null,
  maxEdge = PREVIEW_MAX_EDGE,
): RendererHandle {
  const [status, setStatus] = useState<RendererStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  const renderer = useRef<ImageRenderer | null>(null);
  const pending = useRef<{ recipe: Adjustments; options?: DrawOptions } | null>(null);
  const frame = useRef(0);

  const flush = useCallback(() => {
    frame.current = 0;
    const request = pending.current;
    if (!request || !renderer.current) return;
    renderer.current.draw(request.recipe, request.options);
  }, []);

  const draw = useCallback(
    (recipe: Adjustments, options?: DrawOptions) => {
      pending.current = { recipe, options };
      if (!renderer.current || frame.current) return;
      frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!data || !canvas) {
      setStatus("idle");
      return;
    }
    if (!supportsWebGL2()) {
      setStatus("unsupported");
      return;
    }
    let disposed = false;
    setStatus("loading");
    setError(null);
    // A lost context (GPU reset, tab eviction) is rebuilt once from the data URL.
    const onLost = () => {
      if (disposed) return;
      renderer.current?.destroy();
      renderer.current = null;
      setAttempt((count) => (count < 1 ? count + 1 : count));
      if (attempt >= 1) {
        setError("The graphics context was lost");
        setStatus("error");
      }
    };
    prepare(canvas, data, maxEdge, onLost)
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        renderer.current = created;
        setSize(created.size);
        setStatus("ready");
        if (pending.current) flush();
      })
      .catch((failure: unknown) => {
        if (disposed) return;
        console.error("Image renderer failed:", failure);
        setError(failure instanceof Error ? failure.message : String(failure));
        setStatus("error");
      });
    return () => {
      disposed = true;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [canvasRef, data, maxEdge, attempt, flush]);

  return { status, error, size, draw };
}
