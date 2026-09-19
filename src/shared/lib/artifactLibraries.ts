/**
 * The virtual `/.lib/` folder every artifact workspace has: bundled browser
 * libraries a page references with a relative path (`<script src=".lib/echarts.js">`)
 * without the bytes ever being stored in the workspace or handled by the model.
 * The preview worker serves them, and downloads inline them (see
 * `exportArtifactHtml`) so exported files stay standalone.
 */

import echartsUrl from "virtual:artifact-library-url/echarts";
import lucideUrl from "virtual:artifact-library-url/lucide";
import threeUrl from "virtual:artifact-library-url/three";

export const LIBRARY_FOLDER = ".lib";

export interface ArtifactLibrary {
  /** File name under `.lib/`. */
  name: string;
  /** Where the app serves the file (dev middleware or a hashed build asset). */
  url: string;
  /** Global the classic script defines, for prompts and diagnostics. */
  global: string;
  /** Full source for standalone exports, fetched from the served copy on demand. */
  load: () => Promise<string>;
}

async function fetchSource(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.text();
}

export const ARTIFACT_LIBRARIES: readonly ArtifactLibrary[] = [
  {
    name: "echarts.js",
    url: echartsUrl,
    global: "echarts",
    load: () => fetchSource(echartsUrl),
  },
  {
    name: "three.js",
    url: threeUrl,
    global: "THREE",
    load: () => fetchSource(threeUrl),
  },
  {
    name: "lucide.js",
    url: lucideUrl,
    global: "lucide",
    load: () => fetchSource(lucideUrl),
  },
];

export function findArtifactLibrary(name: string): ArtifactLibrary | undefined {
  return ARTIFACT_LIBRARIES.find((library) => library.name === name);
}

/** `{ "echarts.js": "/assets/echarts-…js", … }` for the preview worker. */
export function artifactLibraryUrls(): Record<string, string> {
  return Object.fromEntries(ARTIFACT_LIBRARIES.map((library) => [library.name, library.url]));
}

/** Whether a workspace path is inside the reserved folder. */
export function isLibraryFolderPath(path: string): boolean {
  return new RegExp(`^/?${LIBRARY_FOLDER.replace(".", "\\.")}(/|$)`).test(path);
}

/** Attribute values that reference the virtual folder with an absolute path: `src="/.lib/x.js"`. */
const ABSOLUTE_LIBRARY_ATTRIBUTE = /(\b(?:src|href)\s*=\s*["']?)\/\.lib\//gi;

/**
 * Rewrite absolute `/.lib/` references so they resolve from `target`, which
 * is either a URL prefix (the preview session root) or a relative prefix
 * (`../` per folder level, for folder exports). Relative references are left alone.
 */
export function rewriteAbsoluteLibraryReferences(html: string, target: string): string {
  return html.replace(ABSOLUTE_LIBRARY_ATTRIBUTE, `$1${target}${LIBRARY_FOLDER}/`);
}

/** `../` for every folder between the page and the workspace root. */
export function relativePrefixToRoot(pagePath: string): string {
  const depth = pagePath.replace(/^\/+/, "").split("/").length - 1;
  return "../".repeat(Math.max(0, depth));
}

/** The library name when a (resolved) reference points into `.lib/` at any depth. */
export function libraryNameFromPath(path: string): string | null {
  const match = new RegExp(`(?:^|/)${LIBRARY_FOLDER.replace(".", "\\.")}/([^/]+)$`).exec(path);
  return match ? match[1] : null;
}

/**
 * Resolve a reference from an HTML page the way a browser would, as an
 * absolute workspace path; null for anchors, data/blob URLs and remote URLs.
 */
export function resolveArtifactReference(pagePath: string, reference: string): string | null {
  if (!reference || reference.startsWith("#") || /^(data|blob):/i.test(reference) || /^[a-z]+:\/\//i.test(reference)) {
    return null;
  }
  const clean = reference.split(/[?#]/, 1)[0];
  const base = pagePath.slice(0, pagePath.lastIndexOf("/") + 1);
  const segments = (clean.startsWith("/") ? clean : `${base}${clean}`).split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return `/${resolved.join("/")}`;
}
