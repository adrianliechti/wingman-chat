import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { getDirectory, readIndex } from "@/shared/lib/opfs-core";
import {
  addDirectoryToZip,
  downloadFolderAsZip,
  extractZipEntry,
  getZipFolder,
  isJunkZipEntry,
} from "@/shared/lib/opfs-zip";
import { downloadBlob } from "@/shared/lib/utils";
import type { Notebook } from "../types/notebook";
import { getNotebook, saveNotebook } from "./opfs-notebook";

/** Build a filesystem-safe slug from a notebook title for the download name. */
function slug(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "notebook";
}

/**
 * Reconcile an imported notebook folder with the collection index.
 *
 * Notebook metadata lives in `notebook.json`, so after extracting a folder we
 * read it back, force its id to match the folder, and re-register it via
 * `saveNotebook` (which writes notebook.json + the index entry).
 *
 * @param bumpUpdatedAt When true, set `updatedAt` to now so the notebook sorts
 *   to the top (single-notebook share). Bulk restores preserve the original.
 */
async function reconcileImportedNotebook(id: string, { bumpUpdatedAt }: { bumpUpdatedAt: boolean }): Promise<void> {
  const existing = await getNotebook(id);
  const now = new Date().toISOString();
  const notebook: Notebook = {
    id,
    title: existing?.title || "Imported Notebook",
    customTitle: existing?.customTitle,
    createdAt: existing?.createdAt || now,
    updatedAt: bumpUpdatedAt ? now : existing?.updatedAt || now,
  };
  await saveNotebook(notebook);
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export a single notebook (metadata, messages, sources, and outputs) as a
 * ZIP download. The notebook folder's contents are placed at the ZIP root.
 */
export async function exportNotebookAsZip(notebookId: string, title?: string): Promise<void> {
  const date = new Date().toISOString().split("T")[0];
  const filename = `wingman-notebook-${slug(title ?? notebookId)}-${date}.zip`;
  await downloadFolderAsZip(`notebooks/${notebookId}`, filename);
}

/**
 * Export all notebooks bundled into a single ZIP, each under
 * `notebooks/{id}/…` so the archive is self-describing.
 */
export async function exportNotebooksAsZip(): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  try {
    const index = await readIndex("notebooks");
    const notebooksZip = getZipFolder(zip, "notebooks");

    for (const entry of index) {
      try {
        const handle = await getDirectory(`notebooks/${entry.id}`);
        await addDirectoryToZip(handle, getZipFolder(notebooksZip, entry.id));
      } catch {
        /* notebook folder missing — skip */
      }
    }
  } catch {
    /* no notebooks */
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, `wingman-notebooks-${new Date().toISOString().split("T")[0]}.zip`);
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import notebooks from a ZIP. Supports both export layouts:
 *  1. Bulk: `notebooks/{id}/…` (from {@link exportNotebooksAsZip}) — ids are
 *     preserved and merged with any existing notebook of the same id, keeping
 *     original timestamps.
 *  2. Flat: `notebook.json` at the root (from {@link exportNotebookAsZip}) —
 *     a fresh id is generated and the notebook is bumped to the top.
 *
 * Throws on archives that match neither layout.
 *
 * @returns The ids of the imported notebooks.
 */
export async function importNotebooksFromZip(file: Blob): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const entries = Object.entries(zip.files).filter(([path]) => !isJunkZipEntry(path));
  const paths = entries.map(([path]) => path);

  const isBulk = paths.some((p) => p.startsWith("notebooks/"));
  const isFlat = !isBulk && paths.some((p) => p === "notebook.json");
  if (!isBulk && !isFlat) {
    throw new Error("Unrecognized archive: expected a notebook export.");
  }

  if (isFlat) {
    const newId = crypto.randomUUID();
    for (const [relativePath, entry] of entries) {
      await extractZipEntry(entry, `notebooks/${newId}/${relativePath}`);
    }
    await reconcileImportedNotebook(newId, { bumpUpdatedAt: true });
    return [newId];
  }

  const ids = new Set<string>();
  for (const [relativePath, entry] of entries) {
    if (!relativePath.startsWith("notebooks/")) continue;

    const after = relativePath.slice("notebooks/".length);
    if (!after) continue;

    // Track the per-notebook folder id; skip a stray collection index.json.
    const id = after.split("/")[0];
    if (!id || id === "index.json") continue;
    ids.add(id);

    await extractZipEntry(entry, `notebooks/${after}`);
  }

  for (const id of ids) {
    await reconcileImportedNotebook(id, { bumpUpdatedAt: false });
  }
  return [...ids];
}

/**
 * Opens a file picker and imports notebooks from the selected ZIP.
 * Handles the confirmation dialog, alert, and page reload on success.
 */
export function triggerNotebookImport(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";
  input.multiple = false;

  input.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (
      !(await confirm({
        title: "Import notebooks?",
        message: "Notebooks from the ZIP will be merged with your existing notebooks.",
      }))
    )
      return;

    try {
      await importNotebooksFromZip(file);
      notify.success("Notebooks imported", "Reloading to show them…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      console.error("Failed to import notebooks:", error);
      notify.error("Couldn't import notebooks", "Check the file and try again.");
    }
  };

  input.click();
}
