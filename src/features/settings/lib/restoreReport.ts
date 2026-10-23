import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import type { RestoreResult } from "@/shared/lib/opfs-restore";

/** Let the user read a partial-import report before reloading the app's state. */
export async function finishRestore(result: RestoreResult): Promise<void> {
  const details = result.skipped
    .slice(0, 8)
    .map(({ path, reason }) => `${path}: ${reason}`)
    .join("\n");
  const summary = `${details}${result.skipped.length > 8 ? `\n…and ${result.skipped.length - 8} more. See the console for the complete list.` : ""}`;
  if (result.skipped.length) console.warn("Skipped backup files:", result.skipped);
  if (!result.restoredFiles) {
    notify.error("No files imported", summary);
    return;
  }
  if (
    result.skipped.length &&
    !(await confirm({
      title: "Import partially completed",
      message: `${result.restoredFiles} files imported. ${result.skipped.length} invalid files and their affected records were skipped. Existing copies were kept.\n\n${summary}\n\nReload to use the imported data.`,
      confirmLabel: "Reload",
      cancelLabel: "Later",
    }))
  )
    return;
  window.location.reload();
}
