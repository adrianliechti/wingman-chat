import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { rolldown } from "@voidzero-dev/vite-plus-core/rolldown";
import type { Plugin } from "vite-plus";

const require = createRequire(import.meta.url);
const threeRoot = path.resolve(path.dirname(require.resolve("three")), "..");
const lucideRoot = path.dirname(require.resolve("lucide/package.json"));
const threeEntry = path.resolve(import.meta.dirname, "artifact-libraries/three.js");
const sdkEntry = path.resolve(import.meta.dirname, "../src/shared/lib/artifactSdk/sdk.ts");
const prefix = "virtual:artifact-library-source/";

type Library = "three" | "lucide" | "wingman-sdk";
type LibrarySource = { source: string; files: string[] };

async function buildThreeSource(): Promise<LibrarySource> {
  // Modern Three.js is ESM-only in the browser. Produce one classic script,
  // including the selected addons and their shared core, for portable HTML.
  const bundle = await rolldown({ input: threeEntry, platform: "browser" });
  try {
    const { output } = await bundle.generate({
      format: "iife",
      name: "THREE",
      minify: true,
      codeSplitting: false,
    });
    const chunk = output[0];
    if (output.length !== 1 || chunk.type !== "chunk" || chunk.imports.length || chunk.dynamicImports.length) {
      throw new Error("The Three.js artifact library must be a single self-contained script.");
    }
    const licensePath = path.join(threeRoot, "LICENSE");
    const license = await fs.readFile(licensePath, "utf8");
    return {
      source: `/*!\n${license}\n*/\n${chunk.code}`,
      files: [...(await bundle.watchFiles), licensePath],
    };
  } finally {
    await bundle.close();
  }
}

async function buildSdkSource(): Promise<LibrarySource> {
  // The page-side `window.wingman` SDK, served into HTML previews as one classic script.
  const bundle = await rolldown({ input: sdkEntry, platform: "browser" });
  try {
    const { output } = await bundle.generate({ format: "iife", minify: true, codeSplitting: false });
    const chunk = output[0];
    if (output.length !== 1 || chunk.type !== "chunk" || chunk.imports.length || chunk.dynamicImports.length) {
      throw new Error("The artifact SDK must be a single self-contained script.");
    }
    return { source: chunk.code, files: [...(await bundle.watchFiles)] };
  } finally {
    await bundle.close();
  }
}

async function readLucideSource(): Promise<LibrarySource> {
  const files = [path.join(lucideRoot, "dist/umd/lucide.min.js"), path.join(lucideRoot, "LICENSE")];
  const [source, license] = await Promise.all(files.map((file) => fs.readFile(file, "utf8")));
  return {
    source: `/*!\n${license}\n*/\n${source.replace(/^\/\/# sourceMappingURL=.*$/gm, "")}`,
    files,
  };
}

/** Browser bundles exported as strings, just like echartsSource in the JS worker. */
export function artifactLibrarySourcesPlugin(): Plugin {
  const sources = new Map<Library, Promise<LibrarySource>>();
  return {
    name: "artifact-library-sources",
    resolveId(id) {
      if (id === `${prefix}three` || id === `${prefix}lucide` || id === `${prefix}wingman-sdk`) return `\0${id}`;
      return undefined;
    },
    async load(id) {
      if (!id.startsWith(`\0${prefix}`)) return undefined;
      const library = id.slice(prefix.length + 1) as Library;
      let pending = sources.get(library);
      if (!pending) {
        pending =
          library === "three" ? buildThreeSource() : library === "wingman-sdk" ? buildSdkSource() : readLucideSource();
        sources.set(library, pending);
      }
      try {
        const { source, files } = await pending;
        for (const file of files) this.addWatchFile(file);
        // A library's string literals must not terminate an inline HTML script.
        return `export default ${JSON.stringify(source.replace(/<\/script/gi, "<\\/script"))};`;
      } catch (error) {
        sources.delete(library);
        throw error;
      }
    },
    watchChange() {
      sources.clear();
    },
  };
}
