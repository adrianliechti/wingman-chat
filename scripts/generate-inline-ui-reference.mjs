import { readFile, writeFile } from "node:fs/promises";
import { format } from "vite-plus/fmt";
import { REFERENCE_GROUPS, updateComponentReference, publishedCatalog } from "../src/shared/lib/inlineUi/registry.ts";

const check = process.argv.includes("--check");

// Character limits are deterministic context-size guards, not tokenizer counts.
const budgets = [
  ["src/features/chat/prompts/inline-ui.txt", 1200],
  ["skills/studio/inline-ui/SKILL.md", 3600],
  ...Object.values(REFERENCE_GROUPS).map((group) => [`skills/studio/inline-ui/${group.path}`, 7200]),
];
for (const group of Object.values(REFERENCE_GROUPS)) {
  const path = `skills/studio/inline-ui/${group.path}`;
  const file = new URL(`../${path}`, import.meta.url);
  const current = await readFile(file, "utf8");
  const reference = updateComponentReference(current, group);
  const updated = (await format(path, reference, { printWidth: 120 })).code;
  if (current === updated) continue;
  if (check) {
    console.error(`${path} is stale. Run npm run generate:ui-reference.`);
    process.exitCode = 1;
  } else {
    await writeFile(file, updated);
    console.log(`Updated ${path}`);
  }
}

const { basicCatalog, wingmanCatalog } = await import("../src/shared/lib/inlineUi/catalog.ts");
for (const { name, catalog } of [
  { name: "basic-catalog", catalog: basicCatalog },
  { name: "wingman-catalog", catalog: wingmanCatalog },
]) {
  const file = new URL(`../skills/studio/inline-ui/references/${name}.json`, import.meta.url);
  const updated = (await format(`${name}.json`, JSON.stringify(publishedCatalog(catalog)), { printWidth: 120 })).code;
  const current = await readFile(file, "utf8").catch(() => "");
  if (current === updated) continue;
  if (check) {
    console.error(`${name}.json is stale. Run npm run generate:ui-reference.`);
    process.exitCode = 1;
  } else await writeFile(file, updated);
}

for (const [path, limit] of budgets) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  if (source.length > limit) {
    console.error(
      `${path} exceeds its context budget: ${source.length} > ${limit} characters. Move detail to a focused lookup.`,
    );
    process.exitCode = 1;
  }
}
