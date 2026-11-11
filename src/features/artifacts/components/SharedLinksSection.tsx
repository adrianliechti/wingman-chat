import { Check, Copy, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { listShares, revokeShare, type SharedLink } from "@/features/artifacts/lib/shareArtifacts";
import { expiryLabel } from "@/features/artifacts/viewer/manifest";
import { confirm } from "@/shared/lib/confirm";
import { formatAbsoluteTime, formatRelativeTime } from "@/shared/lib/formatRelativeTime";
import { notify } from "@/shared/lib/notify";
import { formatBytes } from "@/shared/lib/utils";

type State =
  | { status: "loading" }
  /** The server does not know who is signed in, so it keeps no per-user list. */
  | { status: "unavailable" }
  | { status: "failed"; message: string }
  | { status: "ready"; shares: SharedLink[] };

const ROW_ACTION =
  "rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-800 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-200";

/** The signed-in user's published workspaces, with the means to end each one early. */
export function SharedLinksSection() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listShares(controller.signal)
      .then((shares) => setState(shares ? { status: "ready", shares } : { status: "unavailable" }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load shared links:", error);
        setState({
          status: "failed",
          message: error instanceof Error ? error.message : "The shared links could not be loaded.",
        });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  };

  const copy = (share: SharedLink) => {
    navigator.clipboard
      .writeText(share.url)
      .then(() => {
        setCopied(share.id);
        setTimeout(() => setCopied((current) => (current === share.id ? null : current)), 2000);
      })
      .catch((error: unknown) => console.error("failed to copy", error));
  };

  const revoke = async (share: SharedLink) => {
    const confirmed = await confirm({
      title: `Stop sharing “${share.title}”?`,
      message: "The link stops working for everyone who has it. This cannot be undone.",
      confirmLabel: "Stop sharing",
      danger: true,
    });
    if (!confirmed) return;

    setRevoking(share.id);
    try {
      await revokeShare(share.id);
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", shares: current.shares.filter((item) => item.id !== share.id) }
          : current,
      );
    } catch (error) {
      console.error("Failed to revoke share:", error);
      notify.error("The link is still shared", error);
    }
    setRevoking(null);
  };

  if (state.status === "loading") {
    return (
      <div className="flex justify-center py-6" role="status" aria-label="Loading shared links">
        <Loader2 className="h-4 w-4 animate-spin text-neutral-400 dark:text-neutral-500" />
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
        This server does not know who is signed in, so it cannot list your links or let you stop them. Each link ends
        when it expires.
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
        <button
          type="button"
          onClick={retry}
          className="text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Try again
        </button>
      </div>
    );
  }

  if (state.shares.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
        Nothing is shared right now. Use Share in the artifacts panel to publish a workspace as a web page.
      </p>
    );
  }

  return (
    <ul
      aria-label="Shared links"
      className="divide-y divide-neutral-200/60 overflow-hidden rounded-lg border border-neutral-200/60 dark:divide-neutral-700/60 dark:border-neutral-700/60"
    >
      {state.shares.map((share) => (
        <li key={share.id} className="flex items-center gap-1 py-2 pr-1.5 pl-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200" title={share.title}>
              {share.title}
            </div>
            {/* When it was shared tells apart links to the same page. */}
            <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              <span title={formatAbsoluteTime(share.created)}>Shared {formatRelativeTime(share.created)}</span> ·{" "}
              {share.files === 1 ? "1 file" : `${share.files} files`} · {formatBytes(share.size)} ·{" "}
              <span title={formatAbsoluteTime(share.expiresAt)}>{expiryLabel(share.expiresAt)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => copy(share)}
            title={copied === share.id ? "Copied" : "Copy link"}
            aria-label={copied === share.id ? "Copied" : `Copy link to ${share.title}`}
            className={ROW_ACTION}
          >
            {copied === share.id ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <a
            href={share.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open"
            aria-label={`Open ${share.title}`}
            className={ROW_ACTION}
          >
            <ExternalLink size={15} />
          </a>
          <button
            type="button"
            onClick={() => void revoke(share)}
            disabled={revoking === share.id}
            title="Stop sharing"
            aria-label={`Stop sharing ${share.title}`}
            className={`${ROW_ACTION} hover:text-red-600 dark:hover:text-red-400`}
          >
            {revoking === share.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        </li>
      ))}
    </ul>
  );
}
