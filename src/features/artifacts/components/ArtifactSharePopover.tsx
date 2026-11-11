import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Check, Copy, ExternalLink, Loader2, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import {
  type ArtifactShare,
  publishArtifacts,
  recentShare,
  rememberShare,
  revokeShare,
  shareEntryFor,
} from "@/features/artifacts/lib/shareArtifacts";
import { cn } from "@/shared/lib/cn";
import { formatAbsoluteTime } from "@/shared/lib/formatRelativeTime";
import { formatBytes, getFileName } from "@/shared/lib/utils";
import type { FileEntry } from "@/shared/types/file";
import { useUnsavedPaths } from "@/shared/ui/editors/draftStore";
import { PANEL_CLASS } from "@/shared/ui/menuStyles";

interface ArtifactSharePopoverProps {
  fs: FileSystemManager;
  files: FileEntry[];
  activePath: string | null;
  retentionDays?: number;
  maxSize?: number;
}

/** Toolbar button that publishes the workspace as a web page opening the viewed (or main) page. */
export function ArtifactSharePopover({ fs, files, activePath, retentionDays, maxSize }: ArtifactSharePopoverProps) {
  const entry = shareEntryFor(
    files.map((file) => file.path),
    activePath,
  );
  if (!entry) return null;

  return (
    <Popover>
      <PopoverButton
        className="p-2 md:p-1.5 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 data-open:bg-black/5 dark:data-open:bg-white/5 focus-visible:outline-none"
        title="Share"
        aria-label="Share"
      >
        <Share2 size={13} className="w-4 h-4 md:w-3.25 md:h-3.25" />
      </PopoverButton>
      <PopoverPanel transition anchor="bottom end" className={cn(PANEL_CLASS, "w-80 p-3 [--anchor-gap:4px]")}>
        <SharePanel fs={fs} files={files} entry={entry} retentionDays={retentionDays} maxSize={maxSize} />
      </PopoverPanel>
    </Popover>
  );
}

type ShareState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "published"; share: ArtifactShare; revoking?: boolean; error?: string }
  | { status: "failed"; message: string };

interface SharePanelProps {
  fs: FileSystemManager;
  files: FileEntry[];
  entry: string;
  retentionDays?: number;
  maxSize?: number;
}

const LINK_ACTION =
  "text-[11px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors disabled:opacity-50";

/**
 * Mounted only while the popover is open; closing it cancels an upload in
 * flight. A created link is remembered for the workspace, so opening the
 * popover again shows it instead of offering to publish a second copy.
 */
function SharePanel({ fs, files, entry, retentionDays, maxSize }: SharePanelProps) {
  const workspace = fs.chatId;
  const [state, setState] = useState<ShareState>(() => {
    const share = recentShare(workspace);
    return share ? { status: "published", share } : { status: "idle" };
  });
  const [copied, setCopied] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const size = files.reduce((total, file) => total + (file.size ?? 0), 0);
  const tooLarge = maxSize !== undefined && size > maxSize;
  const lifetime = retentionDays === 1 ? "1 day" : `${retentionDays ?? 7} days`;
  // The upload reads the saved files, so edits still open in an editor would be left out silently.
  const unsaved = [...useUnsavedPaths(workspace)].sort();
  const blocked = tooLarge || unsaved.length > 0;

  const publish = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "publishing" });
    setCopied(false);
    publishArtifacts(fs, entry, controller.signal)
      .then((share) => {
        // The share exists from here on, whether or not this panel is still open.
        rememberShare(workspace, share);
        setState({ status: "published", share });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Failed to share artifacts:", error);
        setState({ status: "failed", message: error instanceof Error ? error.message : "Sharing failed." });
      });
  };

  const revoke = (share: ArtifactShare) => {
    setState({ status: "published", share, revoking: true });
    revokeShare(share.id)
      .then(() => setState({ status: "idle" }))
      .catch((error: unknown) => {
        console.error("Failed to revoke share:", error);
        setState({ status: "published", share, error: error instanceof Error ? error.message : "Revoking failed." });
      });
  };

  const copy = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((error: unknown) => console.error("failed to copy", error));
  };

  return (
    <div className="space-y-2.5">
      <div>
        <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">Share as web page</h3>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          Publishes all {files.length === 1 ? "1 file" : `${files.length} files`} ({formatBytes(size)}), opening{" "}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{getFileName(entry)}</span>. Anyone with
          the link can view it for {lifetime}.
        </p>
      </div>

      {state.status === "published" ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 pl-2.5 pr-1 py-1">
            <input
              readOnly
              value={state.share.url}
              aria-label="Share link"
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent text-xs text-neutral-800 dark:text-neutral-200 outline-none"
            />
            <button
              type="button"
              onClick={() => copy(state.share.url)}
              title={copied ? "Copied" : "Copy link"}
              aria-label={copied ? "Copied" : "Copy link"}
              className="p-1 rounded-md text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <a
              href={state.share.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open"
              aria-label="Open shared page"
              className="p-1 rounded-md text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <ExternalLink size={13} />
            </a>
          </div>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Expires {formatAbsoluteTime(state.share.expiresAt)}. Later changes need a new link.
          </p>
          {state.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={publish}
              disabled={state.revoking || blocked}
              title={unsaved.length > 0 ? "Save or discard your changes first" : undefined}
              className={LINK_ACTION}
            >
              Create new link
            </button>
            {state.share.revocable && (
              <button
                type="button"
                onClick={() => revoke(state.share)}
                disabled={state.revoking}
                className={cn(LINK_ACTION, "hover:text-red-600 dark:hover:text-red-400")}
              >
                {state.revoking ? "Stopping…" : "Stop sharing"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <ul
            aria-label="Files that will be published"
            className="max-h-24 overflow-y-auto rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400"
          >
            {files.map((file) => (
              <li key={file.path} className="truncate" title={file.path}>
                {file.path.replace(/^\/+/, "")}
              </li>
            ))}
          </ul>
          {tooLarge && (
            <p className="text-xs text-red-600 dark:text-red-400">
              The workspace is larger than the {formatBytes(maxSize)} sharing limit.
            </p>
          )}
          {unsaved.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Save or discard your changes to{" "}
              {unsaved.length === 1 ? getFileName(unsaved[0]) : `${unsaved.length} files`} first; unsaved edits are not
              published.
            </p>
          )}
          {state.status === "failed" && <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>}
          <button
            type="button"
            onClick={publish}
            disabled={blocked || state.status === "publishing"}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 px-3 py-1.5 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-white transition-colors disabled:opacity-50"
          >
            {state.status === "publishing" && <Loader2 size={12} className="animate-spin" />}
            {state.status === "publishing" ? "Publishing…" : "Create link"}
          </button>
        </>
      )}
    </div>
  );
}
