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
  cancelled: () => boolean,
): Promise<ImageRenderer | null> {
  const bitmap = await decodeBitmap(decodeDataURL(data), maxEdge);
  let renderer: ImageRenderer | undefined;
  try {
    if (cancelled()) return null;
    renderer = new ImageRenderer(canvas, { onContextLost: onLost });
    renderer.setSource(bitmap);
    return renderer;
  } catch (error) {
    renderer?.destroy();
    throw error;
  } finally {
    bitmap.close();
  }
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
    try {
      renderer.current.draw(request.recipe, request.options);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus("error");
    }
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
    let lost = false;
    let lostTimer: ReturnType<typeof setTimeout> | undefined;
    setStatus("loading");
    setError(null);
    // getContext() returns the same lost context until the browser restores it.
    // Rebuild resources only after webglcontextrestored, keeping the canvas mounted.
    const onRestored = () => {
      if (disposed) return;
      clearTimeout(lostTimer);
      setAttempt((count) => count + 1);
    };
    canvas.addEventListener("webglcontextrestored", onRestored);
    const onLost = () => {
      if (disposed) return;
      lost = true;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      renderer.current?.destroy();
      renderer.current = null;
      setStatus("loading");
      lostTimer = setTimeout(() => {
        setError("The graphics context was lost");
        setStatus("error");
      }, 5000);
    };
    prepare(canvas, data, maxEdge, onLost, () => disposed || lost)
      .then((created) => {
        if (!created) return;
        if (disposed || lost) {
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
      clearTimeout(lostTimer);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [canvasRef, data, maxEdge, attempt, flush]);

  return { status, error, size, draw };
}
