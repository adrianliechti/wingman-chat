import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { rolldown } from "@voidzero-dev/vite-plus-core/rolldown";
import type { Plugin } from "vite-plus";

const require = createRequire(import.meta.url);
const threeRoot = path.resolve(path.dirname(require.resolve("three")), "..");
const lucideRoot = path.dirname(require.resolve("lucide/package.json"));
const echartsRoot = path.dirname(require.resolve("echarts/package.json"));
const tailwindRoot = path.dirname(require.resolve("@tailwindcss/browser/package.json"));
const daisyuiRoot = path.dirname(require.resolve("daisyui/package.json"));
const alpineRoot = path.dirname(require.resolve("alpinejs/package.json"));
const threeEntry = path.resolve(import.meta.dirname, "artifact-libraries/three.js");
const sdkEntry = path.resolve(import.meta.dirname, "../src/shared/lib/artifactSdk/sdk.ts");
const prefix = "virtual:artifact-library-source/";
/** `virtual:artifact-library-url/<lib>` resolves to a URL the app serves the library from. */
const urlPrefix = "virtual:artifact-library-url/";
/** Dev-server path for the served copies; builds emit hashed assets instead. */
const devPath = "/__artifact-libraries__/";

type Library = "three" | "lucide" | "echarts" | "tailwind" | "daisyui" | "daisyui-themes" | "alpine" | "wingman-sdk";
type LibrarySource = { source: string; files: string[] };
const LIBRARIES: Library[] = ["three", "lucide", "echarts", "tailwind", "daisyui", "daisyui-themes", "alpine"];
/** Served file extension and MIME type per library; scripts unless listed here. */
const STYLESHEETS = new Set<Library>(["daisyui", "daisyui-themes"]);
const extensionOf = (library: Library) => (STYLESHEETS.has(library) ? "css" : "js");
const contentTypeOf = (library: Library) =>
  STYLESHEETS.has(library) ? "text/css;charset=utf-8" : "text/javascript;charset=utf-8";

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

async function readEchartsSource(): Promise<LibrarySource> {
  const file = path.join(echartsRoot, "dist/echarts.min.js");
  return { source: await fs.readFile(file, "utf8"), files: [file] };
}

async function readTailwindSource(): Promise<LibrarySource> {
  // Tailwind v4's in-browser compiler: utilities are generated from the page at load time.
  const file = path.join(tailwindRoot, "dist/index.global.js");
  return { source: await fs.readFile(file, "utf8"), files: [file] };
}

async function readDaisyuiSource(file: string): Promise<LibrarySource> {
  // daisyUI's prebuilt stylesheets: component classes on top of Tailwind's utilities.
  const full = path.join(daisyuiRoot, file);
  return { source: await fs.readFile(full, "utf8"), files: [full] };
}

async function readAlpineSource(): Promise<LibrarySource> {
  // Alpine's CDN build registers `window.Alpine` and starts itself once the DOM is ready.
  const file = path.join(alpineRoot, "dist/cdn.min.js");
  return { source: await fs.readFile(file, "utf8"), files: [file] };
}

function buildSource(library: Library): Promise<LibrarySource> {
  if (library === "three") return buildThreeSource();
  if (library === "alpine") return readAlpineSource();
  if (library === "echarts") return readEchartsSource();
  if (library === "tailwind") return readTailwindSource();
  if (library === "daisyui") return readDaisyuiSource("daisyui.css");
  if (library === "daisyui-themes") return readDaisyuiSource("themes.css");
  if (library === "wingman-sdk") return buildSdkSource();
  return readLucideSource();
}

/**
 * Browser bundles as strings (`virtual:artifact-library-source/<lib>`, for
 * inlining into HTML) and as served files (`virtual:artifact-library-url/<lib>`,
 * what the preview worker fetches for `.lib/<lib>.js` references).
 */
export function artifactLibrarySourcesPlugin(): Plugin {
  const sources = new Map<Library, Promise<LibrarySource>>();
  let base = "/";
  let building = false;
  const sourceOf = (library: Library) => {
    let pending = sources.get(library);
    if (!pending) {
      pending = buildSource(library);
      sources.set(library, pending);
    }
    return pending.catch((error) => {
      sources.delete(library);
      throw error;
    });
  };
  return {
    name: "artifact-library-sources",
    configResolved(config) {
      base = config.base.replace(/\/?$/, "/");
      building = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith(devPath)) return next();
        const library = url.slice(devPath.length).replace(/\.(js|css)$/, "") as Library;
        if (!LIBRARIES.includes(library)) return next();
        try {
          const { source } = await sourceOf(library);
          res.setHeader("Content-Type", contentTypeOf(library));
          res.setHeader("Cache-Control", "no-cache");
          res.end(source);
        } catch (error) {
          next(error);
        }
      });
    },
    resolveId(id) {
      for (const library of LIBRARIES) {
        if (id === `${prefix}${library}` || id === `${urlPrefix}${library}`) return `\0${id}`;
      }
      if (id === `${prefix}wingman-sdk`) return `\0${id}`;
      return undefined;
    },
    async load(id) {
      if (id.startsWith(`\0${urlPrefix}`)) {
        const library = id.slice(urlPrefix.length + 1) as Library;
        if (!building) return `export default ${JSON.stringify(`${devPath}${library}.${extensionOf(library)}`)};`;
        const { source, files } = await sourceOf(library);
        for (const file of files) this.addWatchFile(file);
        const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 8);
        const fileName = `assets/${library}-${hash}.${extensionOf(library)}`;
        this.emitFile({ type: "asset", fileName, source });
        return `export default ${JSON.stringify(`${base}${fileName}`)};`;
      }
      if (!id.startsWith(`\0${prefix}`)) return undefined;
      const library = id.slice(prefix.length + 1) as Library;
      const { source, files } = await sourceOf(library);
      for (const file of files) this.addWatchFile(file);
      // A library's string literals must not terminate an inline HTML script.
      return `export default ${JSON.stringify(source.replace(/<\/script/gi, "<\\/script"))};`;
    },
    watchChange() {
      sources.clear();
    },
  };
}
