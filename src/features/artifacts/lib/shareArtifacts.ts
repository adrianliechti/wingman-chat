/**
 * Publishing a workspace as a web page. The browser uploads the folder export
 * (pages with relative `.lib/` references, without the library bytes) and the
 * server hosts it under `/artifacts/{id}/` until its retention passes; see
 * pkg/server/share. Every publish creates a new link.
 */

import type { ExportZipOptions } from "./fs";

export interface ArtifactShare {
  id: string;
  /** Absolute link to the shared page. */
  url: string;
  /** Workspace path of the page the link opens, without the leading slash. */
  entry: string;
  expiresAt: string;
}

export interface ShareSource {
  exportZip(options?: ExportZipOptions): Promise<Blob>;
}

const PAGE = /\.html?$/i;

const depth = (path: string) => path.replace(/^\/+/, "").split("/").length;

/** The page a share opens: the one being viewed, else a root index, else the shallowest page. */
export function shareEntryFor(paths: readonly string[], activePath?: string | null): string | undefined {
  if (activePath && PAGE.test(activePath) && paths.includes(activePath)) return activePath;
  const pages = paths.filter((path) => PAGE.test(path)).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  return pages.find((path) => /^\/?index\.html?$/i.test(path)) ?? pages[0];
}

/** What to tell the user about a rejected upload; proxies answer with HTML pages. */
export function shareErrorMessage(status: number, contentType: string | null, body: string): string {
  const text = body.trim();
  if (text && contentType?.startsWith("text/plain")) return `${text[0].toUpperCase()}${text.slice(1)}.`;
  if (status === 413) return "The workspace is too large to share.";
  return `Sharing failed (${status}).`;
}

export async function publishArtifacts(
  source: ShareSource,
  entry: string,
  signal?: AbortSignal,
): Promise<ArtifactShare> {
  // Text compresses well and the server extracts either way.
  const archive = await source.exportZip({ libraries: false, compression: "DEFLATE" });
  signal?.throwIfAborted();

  const response = await fetch(`/artifacts?entry=${encodeURIComponent(entry.replace(/^\/+/, ""))}`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: archive,
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(shareErrorMessage(response.status, response.headers.get("Content-Type"), body));
  }

  const created = (await response.json()) as Omit<ArtifactShare, "url"> & { url: string };
  return { ...created, url: new URL(created.url, window.location.origin).href };
}
