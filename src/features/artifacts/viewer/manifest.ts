/** What the viewer learns about a share from `/artifacts/{id}/share.json`, and what it derives from it. */

import type { SdkCapabilities } from "@/shared/lib/artifactSdk/protocol";

/** Paths are relative to the share root. */
export interface ShareManifest {
  id: string;
  title: string;
  entry: string;
  expiresAt: string;
  files: string[];
  capabilities: SdkCapabilities;
}

/** The share's description, or null when the link expired or never existed. */
export async function loadShareManifest(id: string): Promise<ShareManifest | null> {
  const response = await fetch(`/artifacts/${encodeURIComponent(id)}/share.json`, { cache: "no-store" }).catch(
    () => null,
  );
  return response?.ok ? ((await response.json()) as ShareManifest) : null;
}

export function shareFileUrl(id: string, path: string): string {
  const encoded = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `/artifacts/${encodeURIComponent(id)}/files/${encoded}`;
}

/** A page the server redirected here from a direct link, else the entry page. */
export function initialPage(manifest: Pick<ShareManifest, "entry" | "files">, requested?: string): string {
  return requested && /\.html?$/i.test(requested) && manifest.files.includes(requested) ? requested : manifest.entry;
}

export function expiryLabel(expiresAt: string, now = new Date()): string {
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return "";
  const format = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `Expires ${format.format(date)}`;
}
