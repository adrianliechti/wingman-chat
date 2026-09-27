import { type CSSProperties, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { createPreviewSession, type PreviewSdkOptions, type PreviewSession } from "@/shared/lib/htmlPreviewSession";
import type { File, FileSystem } from "@/shared/types/file";

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
  fs?: FileSystem;
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
  /**
   * Serve `window.wingman` into the session's HTML documents. Read when the
   * session is created; later capability changes are pushed to the session.
   */
  sdk?: PreviewSdkOptions;
  /** Called with the live session and iframe once files are registered, and with nulls on teardown. */
  onSession?: (session: PreviewSession | null, iframe: HTMLIFrameElement | null) => void;
  /**
   * Decide whether a filesystem change should reload the page. The session's
   * copy of the file is updated either way; returning false only skips the
   * navigation, e.g. for a file the page itself just wrote.
   */
  shouldReload?: (path: string) => boolean;
  /** Receives the iframe element (and null on unmount), e.g. to watch its selection. */
  iframeRef?: (element: HTMLIFrameElement | null) => void;
}

const DEFAULT_PATH = "index.html";
const HTML_CONTENT_TYPE = "text/html;charset=utf-8";

async function listFiles(fs: FileSystem | undefined): Promise<File[]> {
  return fs ? fs.listFiles() : [];
}

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
  sdk,
  onSession,
  shouldReload,
  iframeRef: onIframe,
}: HtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const setIframe = useCallback(
    (element: HTMLIFrameElement | null) => {
      iframeRef.current = element;
      onIframe?.(element);
    },
    [onIframe],
  );
  const sessionRef = useRef<PreviewSession | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last (path, content) actually pushed to the session, so we
  // can skip redundant updateFile + reload cycles that cause iframe flicker.
  const lastPushedRef = useRef<{ path: string; content: string } | null>(null);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Session events read committed props without restarting the filesystem's
  // session or subscriptions when content and host callbacks change.
  const startSession = useEffectEvent((signal: AbortSignal) => createPreviewSession({ sdk, signal }));
  const notifySession = useEffectEvent((next: PreviewSession | null) => {
    onSession?.(next, next ? iframeRef.current : null);
  });
  const includeActiveContent = useEffectEvent((files: Map<string, File>) => {
    if (path && content !== undefined) {
      files.set(path, {
        path,
        content,
        contentType: isHtmlPath(path) ? HTML_CONTENT_TYPE : files.get(path)?.contentType,
      });
      lastPushedRef.current = { path, content };
    }
  });
  const updateSessionFile = useEffectEvent((target: PreviewSession, file: File) =>
    target.updateFile(file.path, {
      ...file,
      content: file.path === path && content !== undefined ? content : file.content,
    }),
  );
  const shouldReloadFile = useEffectEvent((changedPath: string) => shouldReload?.(changedPath) !== false);
  const reloadPage = useEffectEvent(() => {
    reloadTimerRef.current = null;
    const iframe = iframeRef.current;
    const currentSession = sessionRef.current;
    if (iframe && currentSession) iframe.src = currentSession.previewUrl(path);
  });

  const scheduleReload = useEffectEvent(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
    }
    reloadTimerRef.current = setTimeout(reloadPage, reloadDebounceMs);
  });

  // Create session on mount; tear down on unmount.
  // The session is re-created if `fs` identity changes so subscriptions attach
  // to the right manager.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let localSession: PreviewSession | null = null;

    void (async () => {
      try {
        const newSession = await startSession(controller.signal);
        // Own the session immediately so failures during initial file loading
        // cannot leave its page-side snapshot or worker registration behind.
        localSession = newSession;
        if (cancelled) {
          await newSession.destroy();
          return;
        }

        // Build the initial file set: fs files, with in-memory content
        // overriding the active path.
        const files = await listFiles(fs);
        const merged = new Map<string, File>(files.map((file) => [file.path, file]));
        includeActiveContent(merged);

        if (cancelled) {
          await newSession.destroy();
          return;
        }
        await newSession.setFiles(Array.from(merged.values()));
        if (cancelled) {
          await newSession.destroy();
          return;
        }

        // Publish only after all initial files are registered.
        sessionRef.current = newSession;
        setSession(newSession);
        notifySession(newSession);
      } catch (err) {
        if (!cancelled) console.error("Failed to start HTML preview session:", err);
        await localSession?.destroy().catch(() => undefined);
        localSession = null;
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (sessionRef.current) notifySession(null);
      sessionRef.current = null;
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      localSession?.destroy().catch(() => undefined);
      setSession(null);
    };
  }, [fs]);

  // Advertise capability changes (e.g. tools toggled) without rebuilding the session.
  const capabilities = sdk?.capabilities;
  useEffect(() => {
    if (!session || !capabilities) return;
    session
      .setCapabilities(capabilities)
      .catch((err) => console.error("html preview: capabilities update failed", err));
  }, [session, capabilities]);

  // Subscribe to filesystem change events for live reload.
  useEffect(() => {
    if (!fs || !session) return undefined;

    const loadAndUpdate = async (changedPath: string) => {
      const file = await fs.getFile(changedPath);
      if (!file) return;
      // If the editor's in-memory content supersedes fs for the active path,
      // prefer that so we don't flash stale content.
      await updateSessionFile(session, file);
    };

    const onUpsert = (p: string) => {
      const reload = shouldReloadFile(p);
      loadAndUpdate(p)
        .then(() => {
          if (reload && sessionRef.current === session) scheduleReload();
        })
        .catch((err) => console.error("html preview: upsert failed", err));
    };
    const onDeleted = (p: string) => {
      const reload = shouldReloadFile(p);
      session
        .deleteFile(p)
        .then(() => {
          if (reload && sessionRef.current === session) scheduleReload();
        })
        .catch((err) => console.error("html preview: delete failed", err));
    };
    const onRenamed = (oldPath: string, newPath: string) => {
      const reload = shouldReloadFile(oldPath) && shouldReloadFile(newPath);
      session
        .renameFile(oldPath, newPath)
        .then(() => {
          if (reload && sessionRef.current === session) scheduleReload();
        })
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
  }, [fs, session]);

  // When the in-memory `content` changes, push it through and reload.
  useEffect(() => {
    if (!session || !path || content === undefined) return;
    // Skip if this exact payload was already pushed (e.g. by the initial
    // session build). Prevents a redundant reload + flicker on open.
    const last = lastPushedRef.current;
    if (last && last.path === path && last.content === content) return;
    const contentType = isHtmlPath(path) ? HTML_CONTENT_TYPE : undefined;
    lastPushedRef.current = { path, content };
    session
      .updateFile(path, { path, content, contentType })
      .then(() => {
        if (sessionRef.current === session) scheduleReload();
      })
      .catch((err) => console.error("html preview: update of active file failed", err));
  }, [session, path, content]);

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
      ref={setIframe}
      src={session ? session.previewUrl(path) : "about:blank"}
      title={title || "HTML preview"}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      className={className}
      style={style}
    />
  );
}
