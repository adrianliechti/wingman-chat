/**
 * Notebook style inventory.
 *
 * Style templates live as markdown files under the server's notebook directory
 * (`<type>/<id>.md`, with YAML frontmatter for label/description/voices/default)
 * and are enumerated by the server's `GET /notebooks` endpoint (a Vite dev
 * middleware serves the same locally). The inventory is loaded once at startup
 * — alongside the app config — so the style registries in `styles.ts` can read
 * it synchronously.
 */

import type { Style } from "./styles";

interface NotebookEntry {
  type: string;
  id: string;
  label: string;
  description?: string;
  voices?: string[];
  default?: boolean;
  /** Page-absolute URL of the prompt body (frontmatter already stripped). */
  path: string;
}

let entries: NotebookEntry[] = [];

/**
 * Fetch and cache the notebook style inventory. Returns silently on failure
 * (e.g. no notebook directory configured) — registries then fall back to any
 * `config.notebook.*` overrides.
 */
export async function loadNotebooks(): Promise<void> {
  try {
    const resp = await fetch("/notebooks");
    if (!resp.ok) return;
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return;
    const data = await resp.json();
    if (Array.isArray(data)) entries = data as NotebookEntry[];
  } catch {
    // leave entries empty; styles fall back to config overrides
  }
}

/** Built-in styles for an output type, mapped to the `Style` shape used by the registries. */
export function notebookStyles(type: string): Style[] {
  return entries
    .filter((e) => e.type === type)
    .map((e) => ({
      id: e.id,
      label: e.label,
      description: e.description,
      prompt: e.path,
      voices: e.voices,
    }));
}
