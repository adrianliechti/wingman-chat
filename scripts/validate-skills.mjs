#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = "skills";
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 1024;

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name === "SKILL.md") files.push(full);
  }
  return files;
}

function parseFrontmatter(file, content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);

  const values = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    values[key] = value;
  }
  return values;
}

const errors = [];
const names = new Map();
const files = walk(ROOT).sort();

for (const file of files) {
  try {
    const content = fs.readFileSync(file, "utf8");
    const meta = parseFrontmatter(file, content);
    const name = meta.name ?? "";
    const description = meta.description ?? "";
    const folder = path.basename(path.dirname(file));

    if (!NAME_RE.test(name) || name.length > 64) errors.push(`${file}: invalid skill name "${name}"`);
    if (name !== folder) errors.push(`${file}: name "${name}" must match folder "${folder}"`);
    if (!description) errors.push(`${file}: description is required`);
    if (description.length > MAX_DESCRIPTION) {
      errors.push(`${file}: description exceeds ${MAX_DESCRIPTION} characters`);
    }
    if (!content.slice(content.indexOf("---", 3) + 3).trim()) errors.push(`${file}: instructions are empty`);

    const duplicate = names.get(name);
    if (duplicate) errors.push(`${file}: duplicate skill name "${name}" (also ${duplicate})`);
    else if (name) names.set(name, file);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

if (errors.length) {
  console.error(`Skill validation failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

console.log(`Validated ${files.length} skills.`);
