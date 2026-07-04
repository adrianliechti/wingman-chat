import { CloudAlert, CloudCheck, CloudUpload, Lock, RefreshCw } from "lucide-react";
import { type SyncHealth, useSyncStatus } from "../hooks/useSyncStatus";

interface SyncIndicatorProps {
  /** Open the settings drawer at the sync section. */
  onClick?: () => void;
}

function describe(health: SyncHealth, pendingCount: number): string {
  switch (health) {
    case "connecting":
      return "Connecting to sync server…";
    case "locked":
      return "Sync locked — enter your PIN";
    case "error":
      return "Sync error — click for details";
    case "syncing":
      return "Syncing…";
    case "pending":
      return `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync`;
    default:
      return "All changes synced";
  }
}

/** Small always-visible cloud status in the top bar. Hidden when the
 *  deployment has no sync server. */
export function SyncIndicator({ onClick }: SyncIndicatorProps) {
  const { health, pendingCount } = useSyncStatus();

  if (health === "disabled") return null;

  const attention = health === "error" || health === "locked";
  const Icon =
    health === "error"
      ? CloudAlert
      : health === "locked"
        ? Lock
        : health === "syncing" || health === "connecting"
          ? RefreshCw
          : health === "pending"
            ? CloudUpload
            : CloudCheck;

  return (
    <button
      type="button"
      onClick={onClick}
      title={describe(health, pendingCount)}
      aria-label={describe(health, pendingCount)}
      className={`p-2 rounded transition-all duration-150 ease-out ${
        attention
          ? "text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400"
          : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      <Icon size={20} className={health === "syncing" || health === "connecting" ? "animate-spin" : undefined} />
    </button>
  );
}
