/**
 * Default skill templates shipped with the deployment.
 *
 * Templates live as static files under `public/skills/<name>/SKILL.md` and are
 * enumerated by the generated `public/skills/index.json` manifest (see
 * `scripts/skills-index.mjs`). They are fetched lazily and cached here, mirroring
 * the notebook style-template mechanism in `notebook/lib/styles.ts`.
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
}

const INDEX_URL = "/skills/index.json";

let indexPromise: Promise<SkillTemplate[]> | null = null;
const contentCache = new Map<string, Promise<ParsedSkill | null>>();

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
