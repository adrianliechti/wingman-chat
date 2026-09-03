/**
 * Client for a plugin-hub instance (https://agent-plugins.org spec). Fetches
 * its plugin catalog and downloads individual plugin archives, yielding
 * parsed skills ready to install as a plugin.
 */

import type JSZip from "jszip";
import { type ParsedSkill, parseSkillsFromZip } from "@/features/skills/lib/skillParser";
import type { HubMcpServer, HubPlugin } from "./types";

export type HubErrorKind = "network" | "too-large" | "invalid";

export class HubError extends Error {
  kind: HubErrorKind;

  constructor(kind: HubErrorKind, message: string) {
    super(message);
    this.name = "HubError";
    this.kind = kind;
  }
}

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

const catalogCache = new Map<string, Promise<HubPlugin[]>>();

/** Contents of a downloaded plugin archive: its skills plus any `mcp.json` servers. */
export interface DownloadedPlugin {
  skills: ParsedSkill[];
  mcpServers: HubMcpServer[];
}

interface PluginSummary {
  name: string;
  version?: string;
  description?: string;
  source: string;
  skills?: { name: string; description?: string }[] | string[];
  mcpServers?: string[];
  icon?: string;
}

/** Fetch and cache a hub's plugin catalog. Failed/empty results aren't cached, so a later call retries. */
function normalizeHubUrl(hubUrl: string): string {
  const u = new URL(hubUrl);
  u.hash = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.toString();
}

/** Resolve a path against the hub URL, carrying over any query params the hub URL needs (e.g. auth tokens). */
function resolveHubUrl(path: string, hubUrl: string): URL {
  const base = new URL(hubUrl);
  const resolved = new URL(path, base);
  if (resolved.origin === base.origin) {
    for (const [key, value] of base.searchParams) {
      if (!resolved.searchParams.has(key)) resolved.searchParams.append(key, value);
    }
  }
  return resolved;
}

export function loadHubPlugins(hubUrl: string): Promise<HubPlugin[]> {
  hubUrl = normalizeHubUrl(hubUrl);
  const cached = catalogCache.get(hubUrl);
  if (cached) return cached;

  const promise = fetch(hubUrl)
    .then(async (resp) => {
      if (!resp.ok) return [];
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return [];
      const data = await resp.json();
      if (!Array.isArray(data)) return [];
      return (data as PluginSummary[]).map((p) => ({
        id: p.name,
        version: p.version,
        description: p.description,
        source: p.source,
        skills: p.skills?.map((s) => (typeof s === "string" ? { name: s } : s)),
        mcpServers: p.mcpServers,
        icon: p.icon ? resolveHubUrl(p.icon, hubUrl).href : undefined,
      }));
    })
    .catch(() => []);

  void promise.then((plugins) => {
    if (plugins.length === 0) catalogCache.delete(hubUrl);
  });
  catalogCache.set(hubUrl, promise);
  return promise;
}

/** Read the Agent Plugins `mcp.json` document from an archive, if present. */
async function parseMcpServers(zip: JSZip): Promise<HubMcpServer[]> {
  const entry = zip.file("mcp.json");
  if (!entry) return [];

  let doc: unknown;
  try {
    doc = JSON.parse(await entry.async("string"));
  } catch {
    return [];
  }

  const servers = (doc as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];

  const result: HubMcpServer[] = [];
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const { type, url, command } = raw as { type?: unknown; url?: unknown; command?: unknown };
    if (typeof type !== "string") continue;
    result.push({
      name,
      type,
      url: typeof url === "string" ? url : undefined,
      command: typeof command === "string" ? command : undefined,
    });
  }
  return result;
}

/**
 * Download a plugin archive from the hub's `/{name}.zip` endpoint and parse
 * it into skills and MCP servers. Supports both Agent Plugin archives
 * (`skills/{name}/SKILL.md`, `mcp.json`) and the plugin-hub skill-folder
 * fallback (`SKILL.md` at the archive root).
 */
export async function downloadHubPlugin(
  hubUrl: string,
  plugin: HubPlugin,
): Promise<DownloadedPlugin> {
  hubUrl = normalizeHubUrl(hubUrl);
  const url = resolveHubUrl(`${encodeURIComponent(plugin.id)}.zip`, hubUrl);

  let resp: Response;
  try {
    resp = await fetch(url);
  } catch {
    throw new HubError("network", `Failed to reach hub at ${url}`);
  }
  if (!resp.ok) {
    throw new HubError("network", `Hub returned ${resp.status} for ${url}`);
  }

  const bytes = await resp.arrayBuffer();
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new HubError("too-large", `Downloaded archive is too large (${bytes.byteLength} bytes)`);
  }

  const JSZipCtor = (await import("jszip")).default;
  let zip: JSZip;
  try {
    zip = await JSZipCtor.loadAsync(bytes);
  } catch {
    throw new HubError("invalid", `Plugin "${plugin.id}" is not a valid zip archive`);
  }

  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new HubError("too-large", `Plugin archive has too many entries (${entries.length})`);
  }

  const hasRootSkill = Object.prototype.hasOwnProperty.call(zip.files, "SKILL.md");
  const hasNestedSkill = entries.some((e) => !e.dir && e.name.endsWith("/SKILL.md"));

  const skills = await parseSkillsFromZip(zip, { rootIsSkill: hasRootSkill && !hasNestedSkill });

  const uncompressedBytes = skills.reduce(
    (total, skill) => total + (skill.resources?.reduce((sum, r) => sum + r.content.length, 0) ?? 0),
    0,
  );
  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new HubError("too-large", `Plugin "${plugin.id}" resources exceed the size limit`);
  }

  return { skills, mcpServers: await parseMcpServers(zip) };
}
