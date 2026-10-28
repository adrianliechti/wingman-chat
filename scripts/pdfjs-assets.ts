import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite-plus";

// ── pdf.js runtime assets ───────────────────────────────────────────────────
// pdfjs-dist v6 decodes the image formats used by *scanned* PDFs (JPEG2000 via
// openjpeg.wasm, JBIG2 via jbig2.wasm) and applies embedded ICC profiles using
// WebAssembly + data files that it fetches at runtime by exact filename, e.g.
// `${wasmUrl}openjpeg.wasm`. They must therefore be served verbatim (no content
// hashing). This plugin serves them from node_modules in dev and copies the
// folders into the build output so `/pdfjs/{wasm,iccs,cmaps,standard_fonts}/`
// resolve in production too.
export function pdfjsAssetsPlugin(): Plugin {
  const dirs = ["wasm", "iccs", "cmaps", "standard_fonts"];
  const pkgRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

  let outDir = "dist";
  let shouldCopy = false;

  return {
    name: "pdfjs-assets",
    configResolved(config) {
      outDir = config.build.outDir;
      shouldCopy = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const m = url.match(/^\/pdfjs\/([^/]+)\/(.+)$/);
        if (!m || !dirs.includes(m[1])) return next();
        const full = path.join(pkgRoot, m[1], path.posix.normalize(`/${m[2]}`).replace(/^\/+/, ""));
        if (!path.resolve(full).startsWith(path.join(pkgRoot, m[1])) || !fs.existsSync(full)) return next();
        res.end(fs.readFileSync(full));
      });
    },
    closeBundle() {
      if (!shouldCopy) return;
      for (const dir of dirs) {
        const from = path.join(pkgRoot, dir);
        if (fs.existsSync(from)) fs.cpSync(from, path.resolve(outDir, "pdfjs", dir), { recursive: true });
      }
    },
  };
}
