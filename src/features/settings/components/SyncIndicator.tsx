import { BackupStatusIcon } from "./BackupStatusIcon";
import { needsAttention, type SyncHealth, useSyncStatus } from "../hooks/useSyncStatus";
import { describeSyncProgress } from "@/shared/lib/syncProgress";

interface SyncIndicatorProps {
  /** Open the settings drawer at Backup. */
  onClick?: () => void;
}

function describe(health: SyncHealth, pendingCount: number): string {
  switch (health) {
    case "connecting":
      return "Connecting to sync server…";
    case "setup":
      return "Backups disabled — set a PIN or passkey";
    case "locked":
      return "Backup locked — unlock in Backup";
    case "error":
      return "Sync error — click for details";
    case "syncing":
      return "Syncing…";
    case "upload-only":
      return "Local changes uploaded — unlock backup to sync other devices";
    case "pending":
      return `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync`;
    default:
      return "All changes synced";
  }
}

/** Small always-visible cloud status in the top bar. Hidden when the
 *  deployment has no sync server. */
export function SyncIndicator({ onClick }: SyncIndicatorProps) {
  const { health, pendingCount, progress } = useSyncStatus();

  if (health === "disabled") return null;

  const attention = needsAttention(health);
  const description = progress.length
    ? progress.map((item) => describeSyncProgress(item, item.unit)).join("; ")
    : describe(health, pendingCount);

  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      aria-label={description}
      className={`p-2 rounded transition-all duration-150 ease-out ${
        attention
          ? "text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400"
          : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      <BackupStatusIcon health={health} />
    </button>
  );
}
