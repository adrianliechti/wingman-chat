import { readFile, writeFile } from "node:fs/promises";
import { format } from "vite-plus/fmt";
import { updateComponentReference, publishedCatalog } from "../src/shared/lib/inlineUi/registry.ts";

const check = process.argv.includes("--check");
for (const path of ["src/features/chat/prompts/inline-ui.txt", "skills/studio/inline-ui/references/components.md"]) {
  const file = new URL(`../${path}`, import.meta.url);
  const current = await readFile(file, "utf8");
  const reference = updateComponentReference(current);
  const updated = path.endsWith(".md") ? (await format(path, reference, { printWidth: 120 })).code : reference;
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
