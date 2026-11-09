import { CloudAlert, CloudCheck, CloudSync, CloudUpload } from "lucide-react";
import { needsAttention, type SyncHealth } from "../hooks/useSyncStatus";

export function BackupStatusIcon({ health, size = 20 }: { health: SyncHealth; size?: number }) {
  const attention = needsAttention(health);
  const syncing = health === "syncing" || health === "connecting";
  const Icon = attention ? CloudAlert : syncing ? CloudSync : health === "pending" ? CloudUpload : CloudCheck;

  return (
    <Icon
      size={size}
      aria-hidden="true"
      className={`shrink-0 ${attention ? "translate-y-[3px] text-amber-600 dark:text-amber-500" : "text-neutral-600 dark:text-neutral-400"} ${!attention && syncing ? "backup-cloud-sync" : ""}`}
    />
  );
}
