/** Stable provider-safe names; original names remain the remote protocol keys. */
export function mcpToolName(serverId: string, toolName: string): string {
  const slug = (value: string, limit: number) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, limit) || "tool";
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify([serverId, toolName])) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `mcp__${slug(serverId, 16)}__${slug(toolName, 28)}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
