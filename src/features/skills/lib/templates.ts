/**
 * Default skill templates shipped with the deployment.
 *
 * Templates live as files under the server's skills directory (`<name>/SKILL.md`,
 * optionally grouped in category folders) and are enumerated by the server's
 * `GET /skills` inventory endpoint (a Vite dev middleware serves the same in
 * local dev). The inventory, each `SKILL.md` and each resource are cached in
 * the shared query client, so hooks and helper code read the same entries.
 *
 * The Studio category supplies the default capability catalog. Other categories
 * are optional templates users can copy into their editable OPFS skill library.
 */

import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "@/shared/lib/queryClient";
import { type ParsedSkill, parseSkillFile } from "./skillParser";

export interface SkillTemplate {
  name: string;
  description: string;
  /** Group folder (first path segment), or "" when ungrouped. */
  category: string;
  /** Page-absolute URL of the SKILL.md, e.g. "/skills/engineering/code-review/SKILL.md". */
  path: string;
  /** Optional environment requirements (agentskills `compatibility` frontmatter). */
  compatibility?: string;
  /** Bundled resource paths relative to this skill's folder, e.g. "scripts/extract.py". */
  resources?: string[];
}

const INDEX_URL = "/skills";

/**
 * The template manifest. An empty list is served when no manifest is shipped:
 * a missing file falls through to the SPA's index.html, so the response must
 * actually be JSON before it is trusted. An empty or failed result is not kept
 * fresh, so a later mount or focus tries again.
 */
export const skillTemplatesQuery = queryOptions({
  queryKey: ["skills", "templates"] as const,
  queryFn: async (): Promise<SkillTemplate[]> => {
    try {
      const resp = await fetch(INDEX_URL);
      if (!resp.ok) return [];
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return [];
      const data: unknown = await resp.json();
      return Array.isArray(data) ? (data as SkillTemplate[]) : [];
    } catch {
      return [];
    }
  },
  staleTime: (query) => (query.state.data?.length ? Infinity : 0),
  gcTime: Infinity,
});

export function loadSkillTemplates(): Promise<SkillTemplate[]> {
  return queryClient.fetchQuery(skillTemplatesQuery);
}

/** A template's parsed SKILL.md (by its manifest `path`), or null when missing or invalid; nulls are retried later. */
export function skillTemplateQuery(path: string) {
  return queryOptions({
    queryKey: ["skills", "template", path] as const,
    queryFn: async (): Promise<ParsedSkill | null> => {
      try {
        const resp = await fetch(path);
        if (!resp.ok) return null;
        const result = parseSkillFile(await resp.text());
        return result.success ? result.skill : null;
      } catch {
        return null;
      }
    },
    staleTime: (query) => (query.state.data ? Infinity : 0),
    gcTime: Infinity,
  });
}

export function loadSkillTemplate(path: string): Promise<ParsedSkill | null> {
  return queryClient.fetchQuery(skillTemplateQuery(path));
}

export function skillResourceUrl(skillPath: string, resourcePath: string): string {
  const base = skillPath.replace(/\/SKILL\.md$/, "");
  const encoded = resourcePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encoded}`;
}

/** A text/code resource listed in the skill inventory, or null when missing; nulls are retried later. */
export function loadSkillResource(skillPath: string, resourcePath: string): Promise<string | null> {
  const url = skillResourceUrl(skillPath, resourcePath);
  return queryClient.fetchQuery({
    queryKey: ["skills", "resource", url] as const,
    queryFn: async (): Promise<string | null> => {
      try {
        const resp = await fetch(url);
        return resp.ok ? await resp.text() : null;
      } catch {
        return null;
      }
    },
    staleTime: (query) => (query.state.data !== null && query.state.data !== undefined ? Infinity : 0),
    gcTime: Infinity,
  });
}
