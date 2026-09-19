#!/usr/bin/env node
/**
 * Downloads DuckDB-WASM extensions for offline use into
 * public/duckdb/extensions/<engine-version>/wasm_eh/<name>.duckdb_extension.wasm.
 *
 * DuckDB loads extensions from `{repository}/{version}/{platform}/{name}.duckdb_extension.wasm`;
 * the runtime points `custom_extension_repository` at this folder so `LOAD excel`
 * (and autoloading of `read_xlsx`) never leaves the app's origin. Every file is
 * signed by DuckDB and verified on load, so no separate hash list is needed here.
 *
 * ENGINE_VERSION must match the engine inside @duckdb/duckdb-wasm (`SELECT version()`);
 * the browser test in tests/browser/artifact-bridge.spec.ts checks the pairing.
 */

import fs from "node:fs";
import path from "node:path";

const ENGINE_VERSION = "v1.4.3";
const PLATFORM = "wasm_eh";
const REPOSITORY = "https://extensions.duckdb.org";
// parquet and json are extensions in the wasm build, not built-ins; the rest are optional formats.
const EXTENSIONS = ["parquet", "json", "excel", "fts", "icu"];

const outputDir = path.join("public/duckdb/extensions", ENGINE_VERSION, PLATFORM);
fs.mkdirSync(outputDir, { recursive: true });

for (const name of EXTENSIONS) {
  const file = `${name}.duckdb_extension.wasm`;
  const target = path.join(outputDir, file);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    console.log(`duckdb: ${name} already bundled`);
    continue;
  }
  const url = `${REPOSITORY}/${ENGINE_VERSION}/${PLATFORM}/${file}`;
  console.log(`duckdb: downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`duckdb: ${url} responded ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`duckdb: ${url} is not a WebAssembly module`);
  }
  fs.writeFileSync(`${target}.part`, bytes);
  fs.renameSync(`${target}.part`, target);
  console.log(`duckdb: bundled ${name} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
}
