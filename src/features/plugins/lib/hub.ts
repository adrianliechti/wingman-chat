/**
 * Client for a plugin-hub instance (https://agent-plugins.org spec). Fetches
 * its plugin catalog and downloads + verifies individual plugin archives,
 * yielding parsed skills ready to install as a plugin.
 */

import type JSZip from "jszip";
import { type ParsedSkill, parseSkillsFromZip } from "@/features/skills/lib/skillParser";
import type { HubPlugin } from "./types";

export type HubErrorKind = "network" | "integrity" | "too-large" | "no-skills" | "invalid";

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

/** Fetch and cache a hub's plugin catalog. Failed/empty results aren't cached, so a later call retries. */
export function loadHubPlugins(hubUrl: string): Promise<HubPlugin[]> {
  const cached = catalogCache.get(hubUrl);
  if (cached) return cached;

  const promise = fetch(hubUrl)
    .then(async (resp) => {
      if (!resp.ok) return [];
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return [];
      const data = await resp.json();
      return Array.isArray(data?.plugins) ? (data.plugins as HubPlugin[]) : [];
    })
    .catch(() => []);

  void promise.then((plugins) => {
    if (plugins.length === 0) catalogCache.delete(hubUrl);
  });
  catalogCache.set(hubUrl, promise);
  return promise;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Download a plugin archive, verify its size and sha256, and parse it into
 * skills. Supports both Agent Plugin archives (`skills/{name}/SKILL.md`) and
 * the plugin-hub skill-folder fallback (`SKILL.md` at the archive root).
 */
export async function downloadHubPlugin(hubUrl: string, plugin: HubPlugin): Promise<ParsedSkill[]> {
  if (plugin.size > MAX_ARCHIVE_BYTES) {
    throw new HubError("too-large", `Plugin archive is too large (${plugin.size} bytes)`);
  }

  const url = new URL(plugin.download, hubUrl);

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

  if (plugin.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual.toLowerCase() !== plugin.sha256.toLowerCase()) {
      throw new HubError("integrity", `Archive checksum mismatch for plugin "${plugin.id}"`);
    }
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

  if (skills.length === 0) {
    throw new HubError("no-skills", `Plugin "${plugin.id}" contains no valid skills`);
  }

  return skills;
}
