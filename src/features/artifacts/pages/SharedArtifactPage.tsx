import { getRouteApi } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  expiryLabel,
  initialPage,
  loadShareManifest,
  type ShareManifest,
  shareFileUrl,
} from "@/features/artifacts/viewer/manifest";
import { ShareBridge } from "@/features/artifacts/viewer/shareBridge";
import { getConfig } from "@/shared/config";
import { formatAbsoluteTime } from "@/shared/lib/formatRelativeTime";

const route = getRouteApi("/artifacts/$shareId");

// The server sends the same flags as a CSP sandbox; the page never gets the app's origin.
const FRAME_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock";

/**
 * A shared workspace (`/artifacts/{id}`, see pkg/server/share): a minimal
 * header and the shared page in a sandboxed frame. There is no file browser
 * and no download; the page reaches its files only through its own requests
 * and `window.wingman`.
 */
export function SharedArtifactPage() {
  const { shareId } = route.useParams();
  const { page } = route.useSearch();
  const [loaded, setLoaded] = useState<{ id: string; manifest: ShareManifest | null } | null>(null);

  useEffect(() => {
    let active = true;
    void loadShareManifest(shareId).then((manifest) => {
      if (active) setLoaded({ id: shareId, manifest });
    });
    return () => {
      active = false;
    };
  }, [shareId]);

  // Undefined while loading, null when the link expired or never existed.
  const manifest = loaded?.id === shareId ? loaded.manifest : undefined;

  useEffect(() => {
    if (manifest !== undefined) document.title = manifest?.title ?? "Link unavailable";
  }, [manifest]);

  if (manifest === undefined) {
    return (
      <div className="h-dvh flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400 dark:text-neutral-500" />
      </div>
    );
  }

  if (manifest === null) {
    return (
      <div className="h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">This link has expired or does not exist.</p>
      </div>
    );
  }

  const app = getConfig().title;
  return (
    <div className="h-dvh flex flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="shrink-0 h-10 flex items-center gap-2 px-3 border-b border-neutral-200/70 dark:border-white/10">
        <img src="/icon_light.svg" alt={app} title={app} className="h-5 w-5 shrink-0 dark:hidden" />
        <img src="/icon_dark.svg" alt={app} title={app} className="h-5 w-5 shrink-0 hidden dark:block" />
        <h1
          className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-800 dark:text-neutral-200"
          title={manifest.title}
        >
          {manifest.title}
        </h1>
        <span
          className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
          title={formatAbsoluteTime(manifest.expiresAt)}
        >
          {expiryLabel(manifest.expiresAt)}
        </span>
      </header>
      <SharedFrame manifest={manifest} page={initialPage(manifest, page)} />
    </div>
  );
}

function SharedFrame({ manifest, page }: { manifest: ShareManifest; page: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    // Listen before the page loads: its first queries can run before the load event.
    const detach = new ShareBridge(manifest).attach(frame);
    frame.src = shareFileUrl(manifest.id, page);
    return detach;
  }, [manifest, page]);

  // Pages without a background of their own render on white, as in a tab of their own.
  return (
    <iframe
      ref={frameRef}
      title={manifest.title}
      sandbox={FRAME_SANDBOX}
      allow="fullscreen; clipboard-write"
      referrerPolicy="no-referrer"
      className="min-h-0 w-full flex-1 border-0 bg-white [color-scheme:light]"
    />
  );
}
