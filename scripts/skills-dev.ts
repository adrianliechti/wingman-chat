import fs from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite-plus";

// Dev parity for the skill inventory endpoints served by pkg/server/library.
// The Go server isn't running under `npm run dev`, so this plugin serves the
// same inventory and content from the runtime ./skills directory locally.

function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    out[key] = raw.replace(/^["']|["']$/g, "");
  }
  return out;
}

function findSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSkillFiles(p));
    else if (entry.name === "SKILL.md") out.push(p);
  }
  return out;
}

const toRel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");

// Mirror of the Go server's skill-resource listing (pkg/server/library): list
// every bundled file except the SKILL.md itself and hidden files (e.g. .DS_Store).
function inventorySkillResources(skillDir: string): string[] {
  if (!fs.existsSync(skillDir)) return [];
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue; // skip .DS_Store and other hidden files
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      const rel = toRel(skillDir, p);
      if (rel === "SKILL.md") continue;
      out.push(rel);
    }
  };

  walk(skillDir);
  return out.sort((a, b) => a.localeCompare(b));
}

function inventorySkills(root: string) {
  return findSkillFiles(root)
    .map((p) => {
      const fm = parseFrontmatter(fs.readFileSync(p, "utf8"));
      const r = toRel(root, p);
      const parts = r.split("/");
      return {
        name: fm.name ?? "",
        description: fm.description ?? "",
        category: parts.length > 2 ? parts[0] : "",
        path: `/skills/${r}`,
        compatibility: fm.compatibility,
        resources: inventorySkillResources(path.dirname(p)),
      };
    })
    .filter((e) => e.name)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function skillsDevPlugin(): Plugin {
  const root = "skills";

  const sendFile = (res: ServerResponse, urlRel: string) => {
    const clean = path.posix.normalize(`/${urlRel}`).replace(/^\/+/, "");
    const full = path.join(root, clean);
    if (
      !path.resolve(full).startsWith(path.resolve(root) + path.sep) ||
      !fs.existsSync(full) ||
      fs.statSync(full).isDirectory()
    ) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const body = fs.readFileSync(full, "utf8");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.end(body);
  };

  return {
    name: "skills-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === "/skills") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(inventorySkills(root)));
          return;
        }
        if (url.startsWith("/skills/")) return sendFile(res, decodeURIComponent(url.slice(8)));
        next();
      });
    },
  };
}
