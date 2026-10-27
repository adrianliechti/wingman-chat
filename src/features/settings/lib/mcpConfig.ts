import type { ToolIcon } from "@/shared/types/chat";

/** Single reviews each call; combined reviews one prompt for an isolated agent. */
export interface McpApproval {
  mode: "single" | "combined" | "none";
}

export function normalizeMcpApproval(value: unknown): McpApproval | undefined {
  if (value === undefined) return undefined;
  const mode = value && typeof value === "object" && !Array.isArray(value) && "mode" in value ? value.mode : undefined;
  if (mode !== "single" && mode !== "combined" && mode !== "none")
    throw new Error('MCP approval.mode must be "single", "combined" or "none"');
  return { mode };
}

export interface ConfiguredMcpServer {
  id: string;
  url?: string;
  name?: string;
  description?: string;
  icon?: string;
  headers?: Record<string, string>;
  approval?: McpApproval;
}

/** All sources resolve to this shape before any client is constructed. */
export interface McpServerDefinition {
  id: string;
  source: "gateway" | "configured" | "plugin" | "companion";
  /** Plugin provider that owns selection and policy for this server. */
  ownerId?: string;
  url: string;
  name: string;
  description: string;
  icon?: ToolIcon;
  headers?: Record<string, string>;
  approval?: McpApproval;
}

const RESERVED_IDS = new Set(["artifacts", "skills", "skill-builder", "repository", "memory", "companion"]);

export function normalizeMcpUrl(value: string): string {
  const url = new URL(value.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("MCP endpoints must be HTTP(S) URLs without embedded credentials");
  url.hash = "";
  return url.href;
}

export function normalizeMcpHeaders(value: unknown): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value) || Object.values(value).some((v) => typeof v !== "string"))
    throw new Error("MCP headers must be an object of string values");
  const headers = new Headers(value as Record<string, string>);
  const entries = [...headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function normalizeMcpServer(server: McpServerDefinition): McpServerDefinition | undefined {
  try {
    if (
      typeof server.id !== "string" ||
      !server.id ||
      server.id === "." ||
      server.id === ".." ||
      // oxlint-disable-next-line no-control-regex -- Provider IDs cannot contain control characters.
      /[\s/\\?#\u0000-\u001f]/.test(server.id)
    )
      throw new Error("Invalid MCP server ID");
    if (
      (server.source === "gateway" || server.source === "configured") &&
      (RESERVED_IDS.has(server.id) || server.id.startsWith("plugin:"))
    )
      throw new Error("MCP server ID conflicts with a built-in provider");
    // Fail closed: silently ignoring the removed flag would drop a required approval.
    if ("needsApproval" in server) throw new Error("MCP needsApproval was replaced by approval.mode");
    const approval = normalizeMcpApproval(server.approval);
    return {
      ...server,
      ...(approval ? { approval } : {}),
      url: normalizeMcpUrl(server.url),
      name: server.name?.trim() || server.id,
      description: server.description || "",
      headers: normalizeMcpHeaders(server.headers),
    };
  } catch {
    // Do not log URLs or header values: either may contain credentials.
    console.warn(`Skipping invalid MCP server configuration: ${server.id}`);
    return undefined;
  }
}

export function configuredMcpServers(servers: ConfiguredMcpServer[], origin: string): McpServerDefinition[] {
  const result: McpServerDefinition[] = [];
  const ids = new Set<string>();
  for (const server of servers) {
    if (!server || typeof server !== "object") continue;
    const normalized = normalizeMcpServer({
      ...server,
      source: server.url == null ? "gateway" : "configured",
      url:
        typeof server.url === "string" && server.url.startsWith("/")
          ? new URL(server.url, origin).href
          : (server.url ?? new URL(`/api/v1/mcp/${encodeURIComponent(server.id)}`, origin).href),
      name: server.name ?? server.id,
      description: server.description ?? "",
    });
    if (!normalized) continue;
    if (ids.has(normalized.id)) {
      console.warn(`Skipping duplicate MCP server ID: ${normalized.id}`);
      continue;
    }
    ids.add(normalized.id);
    result.push(normalized);
  }
  return result;
}

export function sameMcpServer(a: McpServerDefinition, b: McpServerDefinition): boolean {
  return (
    a.id === b.id &&
    a.url === b.url &&
    a.source === b.source &&
    a.ownerId === b.ownerId &&
    a.name === b.name &&
    a.description === b.description &&
    a.icon === b.icon &&
    (a.approval?.mode ?? "none") === (b.approval?.mode ?? "none") &&
    JSON.stringify(a.headers) === JSON.stringify(b.headers)
  );
}
