/**
 * Folder exports of HTML artifacts. Pages reference bundled libraries as
 * `/.lib/<name>` (served virtually by the preview); a zip export carries the
 * libraries and rewrites absolute references so the extracted folder opens
 * from disk. Single-file downloads are the page as stored.
 */

import {
  findArtifactLibrary,
  libraryNameFromPath,
  relativePrefixToRoot,
  resolveArtifactReference,
  rewriteAbsoluteLibraryReferences,
} from "@/shared/lib/artifactLibraries";
import type { File } from "@/shared/types/file";

const REFERENCE_TAG = /<(?:script|link)\b([^>]*)>/gi;
const SRC_ATTRIBUTE = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

export interface LibraryReference {
  name: string;
  /** Absolute workspace path the page resolves the reference to. */
  resolved: string;
}

export function findLibraryReferences(html: string, pagePath: string): LibraryReference[] {
  const references: LibraryReference[] = [];
  for (const match of html.matchAll(REFERENCE_TAG)) {
    const src = SRC_ATTRIBUTE.exec(match[1]);
    if (!src) continue;
    const resolved = resolveArtifactReference(pagePath, src[1] ?? src[2] ?? src[3] ?? "");
    const name = resolved ? libraryNameFromPath(resolved) : null;
    if (!resolved || !name) continue;
    references.push({ name, resolved });
  }
  return references;
}

export type LibraryLoader = (name: string) => Promise<string | undefined>;

export const loadArtifactLibrary: LibraryLoader = (name) =>
  findArtifactLibrary(name)?.load() ?? Promise.resolve(undefined);

/** A page as it should appear in a folder export: absolute `/.lib/` references made relative. */
export function exportArtifactHtmlForFolder(html: string, pagePath: string): string {
  return rewriteAbsoluteLibraryReferences(html, relativePrefixToRoot(pagePath));
}

/** Each referenced library at the path a page resolves it to, for folder exports. */
export async function collectReferencedLibraries(
  files: Array<Pick<File, "path" | "content">>,
  load: LibraryLoader = loadArtifactLibrary,
): Promise<Map<string, string>> {
  const libraries = new Map<string, string>();
  for (const file of files) {
    if (!/\.html?$/i.test(file.path)) continue;
    for (const reference of findLibraryReferences(file.content, file.path)) {
      if (libraries.has(reference.resolved)) continue;
      const source = await load(reference.name);
      if (source !== undefined) libraries.set(reference.resolved, source);
    }
  }
  return libraries;
}
