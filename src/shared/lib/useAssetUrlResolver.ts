import { useCallback, useEffect, useRef, useState } from "react";
import { contentToBlob } from "@/shared/lib/fileContent";
import type { FileSystem } from "@/shared/types/file";

/**
 * Normalize a reference `url` against a `basePath` into an absolute-from-root
 * path usable to look up a file in the artifact filesystem.
 *
 * - Absolute paths (starting with `/`) are normalized as-is.
 * - Relative paths are joined with `basePath` (the directory containing the
 *   referring document).
 * - `.` and `..` segments collapse normally (anchored at root).
 * - Returns `null` for URLs we shouldn't rewrite (hash-only, `data:`, `blob:`,
 *   `http:`, any scheme-qualified URL).
 */
export function resolveAssetPath(url: string, basePath: string | undefined): string | null {
  if (!url || url.startsWith("#")) return null;
  // Any URL with a scheme: http:, https:, data:, blob:, mailto:, ...
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;

  // Strip query + fragment — fs lookups are by path only.
  const path = url.split(/[?#]/, 1)[0];
  if (!path) return null;

  const baseDir = basePath ? basePath.replace(/\/[^/]*$/, "") : "";
  const combined = path.startsWith("/") ? path : `${baseDir}/${path}`;

  const segments: string[] = [];
  for (const segment of combined.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/**
 * Lazy blob-URL resolver for artifact files. Intended for rendering contexts
 * (e.g. markdown `<img>`) that want to display sibling files by relative path.
 *
 * Usage:
 * ```tsx
 * const resolve = useAssetUrlResolver(fs, "/docs/guide.md");
 * <img src={resolve("image.png") ?? "image.png"} />
 * ```
 *
 * Returns `undefined` until the file is loaded (callers should fall back to
 * the raw URL). Subscribes to fs events to invalidate on change. Revokes all
 * blob URLs on unmount.
 */
export function useAssetUrlResolver(
  fs: FileSystem | undefined,
  basePath: string | undefined,
): (url: string) => string | undefined {
  // Map value states:
  //   missing    → not yet requested
  //   "pending"  → in-flight fetch
  //   string     → resolved blob URL
  //   null       → known not-found (avoid retry loops)
  const cacheRef = useRef<Map<string, string | null | "pending">>(new Map());
  // Bump on each change so <img> tags re-render with the resolved URL.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const load = useCallback(
    async (absPath: string) => {
      if (!fs || cacheRef.current.has(absPath)) return;
      cacheRef.current.set(absPath, "pending");
      try {
        const file = await fs.getFile(absPath);
        cacheRef.current.set(absPath, file ? URL.createObjectURL(contentToBlob(file.content, file.contentType)) : null);
      } catch {
        cacheRef.current.set(absPath, null);
      }
      bump();
    },
    [fs, bump],
  );

  const invalidate = useCallback(
    (absPath: string) => {
      const existing = cacheRef.current.get(absPath);
      if (typeof existing === "string") URL.revokeObjectURL(existing);
      cacheRef.current.delete(absPath);
      bump();
    },
    [bump],
  );

  useEffect(() => {
    if (!fs) return undefined;
    const unsubs = [
      fs.subscribe("fileCreated", invalidate),
      fs.subscribe("fileUpdated", invalidate),
      fs.subscribe("fileDeleted", invalidate),
      fs.subscribe("fileRenamed", (oldPath, newPath) => {
        invalidate(oldPath);
        invalidate(newPath);
      }),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [fs, invalidate]);

  // Revoke everything on unmount.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const value of cache.values()) {
        if (typeof value === "string") URL.revokeObjectURL(value);
      }
      cache.clear();
    };
  }, []);

  return useCallback(
    (url: string): string | undefined => {
      if (!fs) return undefined;
      const absPath = resolveAssetPath(url, basePath);
      if (!absPath) return undefined;

      const entry = cacheRef.current.get(absPath);
      if (entry === undefined) {
        // Kick off load; caller falls back to raw URL this render.
        void load(absPath);
        return undefined;
      }
      return typeof entry === "string" ? entry : undefined;
    },
    [fs, basePath, load],
  );
}
