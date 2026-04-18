import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { File } from "@/features/artifacts/types/file";
import { createPreviewSession, type PreviewSession } from "@/shared/lib/htmlPreviewSession";

export interface HtmlPreviewProps {
  /**
   * Path of the entry document the iframe should navigate to.
   * Relative paths are resolved against this document just like a web server.
   * Defaults to `"index.html"`.
   */
  path?: string;
  /**
   * In-memory content for the entry document. This overrides whatever is in
   * `fs` for the same path so that unsaved editor changes are visible
   * without a round-trip through the filesystem.
   */
  content?: string;
  /**
   * Optional filesystem manager to source sibling files from (CSS, JS,
   * images, other HTML documents, ...). When provided, all files are loaded
   * on mount and live-reload subscriptions are set up for external changes
   * (rename/delete/create/update).
   */
  fs?: HtmlPreviewFileSource;
  /**
   * iframe title attribute.
   */
  title?: string;
  /**
   * iframe className. Defaults to filling the parent.
   */
  className?: string;
  /**
   * iframe inline style.
   */
  style?: CSSProperties;
  /**
   * How long to wait after the content changes before reloading the iframe.
   * Prevents reload storms while content streams in. Defaults to 150ms.
   */
  reloadDebounceMs?: number;
}

/**
 * Minimal interface that `HtmlPreview` needs from a filesystem manager.
 * Compatible with `FileSystemManager` in the artifacts feature.
 */
export interface HtmlPreviewFileSource {
  listFiles(): Promise<File[]>;
  getFile(path: string): Promise<File | undefined>;
  subscribe(eventType: "fileCreated" | "fileUpdated", handler: (path: string) => void): () => void;
  subscribe(eventType: "fileDeleted", handler: (path: string) => void): () => void;
  subscribe(eventType: "fileRenamed", handler: (oldPath: string, newPath: string) => void): () => void;
}

const DEFAULT_PATH = "index.html";
const HTML_CONTENT_TYPE = "text/html;charset=utf-8";

function isHtmlPath(path: string): boolean {
  return path.endsWith(".html") || path.endsWith(".htm");
}

/**
 * Renders HTML inside a sandboxed iframe served via the artifact preview
 * service worker. Unlike `srcDoc`, this gives the iframe a real origin path
 * so relative URLs, fetch, navigation between pages, subfolders and forms
 * all behave as if served from a web server.
 *
 * Supports two input modes (which can be combined):
 *
 * 1. **Single document**: pass `content` (and optionally `path`). Useful for
 *    chat-message code blocks.
 * 2. **Filesystem-backed**: pass `fs` to load all files and subscribe to
 *    live changes — used by the artifacts drawer editor.
 */
export function HtmlPreview({
  path = DEFAULT_PATH,
  content,
  fs,
  title,
  className = "w-full h-full",
  style,
  reloadDebounceMs = 150,
}: HtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sessionRef = useRef<PreviewSession | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const pathRef = useRef(path);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep refs in sync so async callbacks see the latest values.
  contentRef.current = content;
  pathRef.current = path;

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
    }
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      const iframe = iframeRef.current;
      const currentSession = sessionRef.current;
      if (!iframe || !currentSession) return;
      iframe.src = currentSession.previewUrl(pathRef.current);
    }, reloadDebounceMs);
  }, [reloadDebounceMs]);

  // Create session on mount; tear down on unmount.
  // The session is re-created if `fs` identity changes so subscriptions attach
  // to the right manager.
  useEffect(() => {
    let cancelled = false;
    let localSession: PreviewSession | null = null;

    (async () => {
      try {
        const newSession = await createPreviewSession();
        if (cancelled) {
          await newSession.destroy();
          return;
        }
        localSession = newSession;
        sessionRef.current = newSession;

        // Build the initial file set: fs files, with in-memory content
        // overriding the active path.
        const merged = new Map<string, File>();
        if (fs) {
          for (const file of await fs.listFiles()) {
            merged.set(file.path, file);
          }
        }
        const activePath = pathRef.current;
        const activeContent = contentRef.current;
        if (activePath && activeContent !== undefined) {
          merged.set(activePath, {
            path: activePath,
            content: activeContent,
            contentType: isHtmlPath(activePath) ? HTML_CONTENT_TYPE : merged.get(activePath)?.contentType,
          });
        }

        if (cancelled) {
          await newSession.destroy();
          sessionRef.current = null;
          return;
        }
        await newSession.setFiles(Array.from(merged.values()));
        if (cancelled) {
          await newSession.destroy();
          sessionRef.current = null;
          return;
        }
        setSession(newSession);
      } catch (err) {
        console.error("Failed to start HTML preview session:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      sessionRef.current = null;
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      localSession?.destroy().catch(() => undefined);
      setSession(null);
    };
  }, [fs]);

  // Subscribe to filesystem change events for live reload.
  useEffect(() => {
    if (!fs || !session) return undefined;

    const loadAndUpdate = async (changedPath: string) => {
      const file = await fs.getFile(changedPath);
      if (!file) return;
      // If the editor's in-memory content supersedes fs for the active path,
      // prefer that so we don't flash stale content.
      const effectiveContent =
        changedPath === pathRef.current && contentRef.current !== undefined ? contentRef.current : file.content;
      await session.updateFile(changedPath, { ...file, content: effectiveContent });
    };

    const onUpsert = (p: string) => {
      loadAndUpdate(p)
        .then(() => scheduleReload())
        .catch((err) => console.error("html preview: upsert failed", err));
    };
    const onDeleted = (p: string) => {
      session
        .deleteFile(p)
        .then(() => scheduleReload())
        .catch((err) => console.error("html preview: delete failed", err));
    };
    const onRenamed = (oldPath: string, newPath: string) => {
      session
        .renameFile(oldPath, newPath)
        .then(() => scheduleReload())
        .catch((err) => console.error("html preview: rename failed", err));
    };

    const unsubs = [
      fs.subscribe("fileCreated", onUpsert),
      fs.subscribe("fileUpdated", onUpsert),
      fs.subscribe("fileDeleted", onDeleted),
      fs.subscribe("fileRenamed", onRenamed),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [fs, session, scheduleReload]);

  // When the in-memory `content` changes, push it through and reload.
  useEffect(() => {
    if (!session || !path || content === undefined) return;
    const contentType = isHtmlPath(path) ? HTML_CONTENT_TYPE : undefined;
    session
      .updateFile(path, { path, content, contentType })
      .then(() => scheduleReload())
      .catch((err) => console.error("html preview: update of active file failed", err));
  }, [session, path, content, scheduleReload]);

  if (error) {
    return (
      <div className={className} style={style}>
        <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-4 text-sm text-red-600 dark:text-red-400">
          <p className="font-medium">HTML preview unavailable</p>
          <p className="text-center">{error}</p>
          <p className="text-neutral-500 dark:text-neutral-400 text-xs text-center">
            HTML previews require a service worker, which needs a secure context (https or localhost).
          </p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={session ? session.previewUrl(path) : "about:blank"}
      title={title || "HTML preview"}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      className={className}
      style={style}
    />
  );
}
