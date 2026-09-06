import type { Agent } from "../types/agent";

// --- AGENTS.md serialization / parsing ---

export function serializeAgentMd(agent: Agent): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${JSON.stringify(agent.name)}`);
  if (agent.model) lines.push(`model: ${JSON.stringify(agent.model)}`);
  if (agent.skills.length > 0) lines.push(`skills: ${JSON.stringify(agent.skills)}`);
  if (agent.tools.length > 0) lines.push(`tools: ${JSON.stringify(agent.tools)}`);
  if (agent.memory) lines.push("memory: true");
  lines.push("---");
  if (agent.instructions) {
    lines.push("");
    lines.push(agent.instructions);
  }
  return lines.join("\n");
}

export function parseAgentMd(content: string):
  | {
      name: string;
      model?: string;
      skills: string[];
      tools: string[];
      memory?: boolean;
      instructions?: string;
    }
  | undefined {
  const match = content.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match) return undefined;

  const frontmatter = match[1];
  const body = match[2]?.trim() || undefined;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }

  // Parse YAML list values — supports bracket arrays ['a', 'b'], or comma-separated a, b
  const parseList = (val?: string): string[] => {
    if (!val) return [];
    try {
      const parsed: unknown = JSON.parse(val);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
    } catch {
      /* Accept the unquoted and single-quoted lists in shared agents. */
    }
    // Bracket array: ['a', 'b'] or [a, b]
    const bracketMatch = val.match(/^\[(.*)\]$/);
    if (bracketMatch) {
      return bracketMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    // Comma-separated (legacy)
    return val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const parseString = (value?: string): string | undefined => {
    if (!value) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* bare YAML scalar */
    }
    return value.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
  };
  return {
    name: parseString(fields.name) || "Untitled",
    skills: parseList(fields.skills),
    tools: parseList(fields.tools),
    model: parseString(fields.model),
    memory: fields.memory === "true",
    instructions: body,
  };
}
