#!/usr/bin/env node
/**
 * Generates public/skills/index.json — the manifest of default skill templates.
 *
 * A default skill is any `SKILL.md` (YAML frontmatter + markdown body) found
 * anywhere under public/skills/, at any depth. Nesting is used purely for
 * grouping, e.g. public/skills/<category>/<name>/SKILL.md. HTTP can't list a
 * directory, so the frontend reads this manifest to enumerate the available
 * templates and then lazily fetches each SKILL.md by its `path`.
 *
 * Adding a default skill = drop a folder containing a SKILL.md and rebuild; the
 * `name`/`description` here come straight from its frontmatter, and `category`
 * from the first path segment when the skill is nested in a group folder.
 */

import fs from "node:fs";
import path from "node:path";

const SKILLS_DIR = "public/skills";

/** Extract the leading `---`…`---` YAML frontmatter as flat key/value pairs. */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};

  const fields = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

/** Recursively collect every SKILL.md path (relative to SKILLS_DIR, POSIX slashes). */
function findSkillFiles(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSkillFiles(abs, base));
    } else if (entry.name === "SKILL.md") {
      out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return out;
}

if (!fs.existsSync(SKILLS_DIR)) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

const entries = findSkillFiles(SKILLS_DIR, SKILLS_DIR)
  .map((relPath) => {
    const { name, description } = parseFrontmatter(fs.readFileSync(path.join(SKILLS_DIR, relPath), "utf8"));
    if (!name) {
      console.warn(`skills-index: skipping ${relPath} — missing "name" in frontmatter`);
      return null;
    }
    const segments = path.dirname(relPath).split("/");
    const category = segments.length > 1 ? segments[0] : "";
    return { name, description: description ?? "", category, path: `${SKILLS_DIR.replace(/^public/, "")}/${relPath}` };
  })
  .filter(Boolean)
  .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

fs.writeFileSync(path.join(SKILLS_DIR, "index.json"), `${JSON.stringify(entries, null, 2)}\n`);
console.log(`skills-index: wrote ${entries.length} skill(s) to ${SKILLS_DIR}/index.json`);
