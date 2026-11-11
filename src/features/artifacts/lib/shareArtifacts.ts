/**
 * Publishing a workspace as a web page. The browser uploads the folder export
 * (pages with relative `.lib/` references, without the library bytes) and the
 * server hosts it under `/artifacts/{id}/` until its retention passes; see
 * pkg/server/share. Every publish creates a new link, which its publisher can
 * list and revoke when the server knows who is signed in.
 */

import type { ExportZipOptions } from "./fs";

export interface ArtifactShare {
  id: string;
  /** Absolute link to the shared page. */
  url: string;
  /** Workspace path of the page the link opens, without the leading slash. */
  entry: string;
  expiresAt: string;
  /** Whether its publisher can end the share early; false when the server does not know who published it. */
  revocable?: boolean;
}

/** One of the signed-in user's own shares, as the server lists them. */
export interface SharedLink {
  id: string;
  /** Absolute link to the shared page. */
  url: string;
  title: string;
  entry: string;
  files: number;
  size: number;
  created: string;
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

/** What to tell the user about a refused request; proxies answer with HTML pages. */
export function shareErrorMessage(
  status: number,
  contentType: string | null,
  body: string,
  action = "Sharing",
): string {
  const text = body.trim();
  if (text && contentType?.startsWith("text/plain")) return `${text[0].toUpperCase()}${text.slice(1)}.`;
  if (status === 413) return "The workspace is too large to share.";
  return `${action} failed (${status}).`;
}

const absolute = (url: string) => new URL(url, window.location.origin).href;

// The link last created for each workspace in this session. The share popover
// is unmounted whenever it closes; without this, closing it would lose a link
// that stays live on the server.
const recent = new Map<string, ArtifactShare>();

export function rememberShare(workspace: string, share: ArtifactShare): void {
  recent.set(workspace, share);
}

/** The workspace's remembered link, unless it has expired or was revoked. */
export function recentShare(workspace: string, now = Date.now()): ArtifactShare | undefined {
  const share = recent.get(workspace);
  if (share && new Date(share.expiresAt).getTime() <= now) recent.delete(workspace);
  return recent.get(workspace);
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

  const created = (await response.json()) as ArtifactShare;
  return { ...created, url: absolute(created.url) };
}

/**
 * The signed-in user's live shares, newest first. Null when the server cannot
 * tell its users apart: it then keeps no list, and links only end by expiring.
 */
export async function listShares(signal?: AbortSignal): Promise<SharedLink[] | null> {
  const response = await fetch("/artifacts", { cache: "no-store", signal });
  if (response.status === 403) return null;
  if (!response.ok) throw new Error(`The shared links could not be loaded (${response.status}).`);

  const shares = (await response.json()) as SharedLink[];
  return shares.map((share) => ({ ...share, url: absolute(share.url) }));
}

/** Ends a share now: its link and files stop being served. */
export async function revokeShare(id: string): Promise<void> {
  const response = await fetch(`/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" });
  // Already gone (expired, or revoked from another window) is what was asked for.
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => "");
    throw new Error(shareErrorMessage(response.status, response.headers.get("Content-Type"), body, "Revoking"));
  }
  for (const [workspace, share] of recent) if (share.id === id) recent.delete(workspace);
}
