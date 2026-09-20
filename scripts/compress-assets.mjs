#!/usr/bin/env node
// Run after Vite and its asset-copying plugins have finished, including WASM
// runtimes copied from public/. Keep originals for clients without compression.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const compressible = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".wasm"]);

export async function compressAssets(root) {
  const totals = { files: 0, original: 0, brotli: 0, gzip: 0 };

  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile() || !compressible.has(path.extname(entry.name))) continue;

      const source = await fs.readFile(file);
      // Bound build memory by processing one asset at a time. Quality 6 gives
      // good WASM/JS compression without quality 11's much longer build times.
      const variants =
        source.length < 1024
          ? []
          : await Promise.all([
              brotliAsync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
              gzipAsync(source, { level: 9 }),
            ]);

      for (const [index, suffix] of [".br", ".gz"].entries()) {
        const compressed = variants[index];
        if (compressed && compressed.length < source.length) {
          await fs.writeFile(`${file}${suffix}`, compressed);
        } else {
          // A rerun must not leave an old variant behind after a source change.
          await fs.rm(`${file}${suffix}`, { force: true });
        }
      }

      if (variants.length) {
        totals.files++;
        totals.original += source.length;
        totals.brotli += Math.min(source.length, variants[0].length);
        totals.gzip += Math.min(source.length, variants[1].length);
      }
    }
  }

  await walk(root);
  return totals;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const totals = await compressAssets(process.argv[2] ?? "dist");
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  console.log(
    `Precompressed ${totals.files} assets: ${mb(totals.original)} → Brotli ${mb(totals.brotli)}, gzip ${mb(totals.gzip)}`,
  );
}
