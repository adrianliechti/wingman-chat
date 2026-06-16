/**
 * Default skill templates shipped with the deployment.
 *
 * Templates live as files under the server's skills directory (`<name>/SKILL.md`,
 * optionally grouped in category folders) and are enumerated by the server's
 * `GET /skills` inventory endpoint (a Vite dev middleware serves the same in
 * local dev). Each entry's `SKILL.md` is fetched lazily and cached here.
 *
 * Templates are not skills themselves — the catalog offers them as starting
 * points that the user copies into their own (editable) OPFS skill library.
 */

import { type ParsedSkill, parseSkillFile } from "./skillParser";

export interface SkillTemplate {
  name: string;
  description: string;
  /** Group folder (first path segment), or "" when ungrouped. */
  category: string;
  /** Page-absolute URL of the SKILL.md, e.g. "/skills/engineering/code-review/SKILL.md". */
  path: string;
  /** Bundled resource paths relative to this skill's folder, e.g. "scripts/extract.py". */
  resources?: string[];
}

const INDEX_URL = "/skills";

let indexPromise: Promise<SkillTemplate[]> | null = null;
const contentCache = new Map<string, Promise<ParsedSkill | null>>();
const resourceCache = new Map<string, Promise<string | null>>();

/**
 * Fetch and cache the template manifest. Returns an empty list when no manifest
 * is shipped — a missing file falls through to the SPA's index.html, so we
 * verify the response is actually JSON before trusting it.
 */
export function loadSkillTemplates(): Promise<SkillTemplate[]> {
  if (indexPromise) return indexPromise;

  indexPromise = fetch(INDEX_URL)
    .then(async (resp) => {
      if (!resp.ok) return [];
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return [];
      const data = await resp.json();
      return Array.isArray(data) ? (data as SkillTemplate[]) : [];
    })
    .catch(() => []);

  // Don't cache an empty/failed result permanently — let a later call retry.
  indexPromise.then((templates) => {
    if (templates.length === 0) indexPromise = null;
  });

  return indexPromise;
}

/**
 * Fetch a template's SKILL.md (by its manifest `path`) and parse it into a
 * skill. Returns null if the file is missing or fails validation. Results are
 * cached per path.
 */
export function loadSkillTemplate(path: string): Promise<ParsedSkill | null> {
  const cached = contentCache.get(path);
  if (cached) return cached;

  const promise = fetch(path)
    .then(async (resp) => {
      if (!resp.ok) return null;
      const result = parseSkillFile(await resp.text());
      return result.success ? result.skill : null;
    })
    .catch(() => null);

  // Drop failed entries so a later attempt can fire a new request.
  promise.then((skill) => {
    if (!skill) contentCache.delete(path);
  });
  contentCache.set(path, promise);
  return promise;
}

export function skillResourceUrl(skillPath: string, resourcePath: string): string {
  const base = skillPath.replace(/\/SKILL\.md$/, "");
  const encoded = resourcePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encoded}`;
}

/** Fetch a text/code resource listed in the skill inventory. */
export function loadSkillResource(skillPath: string, resourcePath: string): Promise<string | null> {
  const url = skillResourceUrl(skillPath, resourcePath);
  const cached = resourceCache.get(url);
  if (cached) return cached;

  const promise = fetch(url)
    .then(async (resp) => {
      if (!resp.ok) return null;
      return resp.text();
    })
    .catch(() => null);

  promise.then((content) => {
    if (content === null) resourceCache.delete(url);
  });
  resourceCache.set(url, promise);
  return promise;
}
