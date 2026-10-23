import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { compressAssets } from "./compress-assets.mjs";

const decoders = [
  { suffix: ".br", decode: brotliDecompressSync },
  { suffix: ".gz", decode: gunzipSync },
];

await test("precompresses nested runtime assets and replaces or removes stale variants", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wingman-compress-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "pyodide"));
  const files = new Map([
    ["pyodide/runtime.wasm", Buffer.concat([Buffer.from("\0asm\x01\0\0\0"), Buffer.alloc(4096, 42)])],
    ["app.js", Buffer.from("console.log('hello');\n".repeat(200))],
    ["index.html", Buffer.from("<p>App shell</p>".repeat(200))],
    ["app.css", Buffer.from("body { color: black; }\n".repeat(200))],
  ]);
  const skipped = new Map([
    ["small.js", Buffer.from("export {};")],
    ["photo.png", Buffer.alloc(4096)],
    ["package.whl", Buffer.alloc(4096)],
    ["random.wasm", randomBytes(4096)],
    ["logo_dark.svg", Buffer.from("<svg></svg>".repeat(200))],
    ["icon_light.svg", Buffer.from("<svg></svg>".repeat(200))],
    ["manifest.json", Buffer.from(JSON.stringify({ name: "x".repeat(2048) }))],
  ]);
  for (const [name, source] of [...files, ...skipped]) {
    await fs.writeFile(path.join(root, name), source);
  }

  await compressAssets(root);
  for (const [name, source] of files) {
    const file = path.join(root, name);
    assert.deepEqual(await fs.readFile(file), source, `${name}: original is preserved`);
    for (const { suffix, decode } of decoders) {
      const encoded = await fs.readFile(`${file}${suffix}`);
      assert.ok(encoded.length < source.length, `${name}${suffix}: saves bytes`);
      assert.deepEqual(decode(encoded), source, `${name}${suffix}: round trip`);
    }
  }
  for (const name of skipped.keys()) {
    for (const suffix of [".br", ".gz"]) {
      await assert.rejects(fs.stat(path.join(root, `${name}${suffix}`)), { code: "ENOENT" });
    }
  }

  const replacement = Buffer.from("console.log('updated');\n".repeat(200));
  await fs.writeFile(path.join(root, "app.js"), replacement);
  await fs.writeFile(path.join(root, "app.css"), "body {}");
  await compressAssets(root);
  for (const { suffix, decode } of decoders) {
    assert.deepEqual(decode(await fs.readFile(path.join(root, `app.js${suffix}`))), replacement);
    await assert.rejects(fs.stat(path.join(root, `app.css${suffix}`)), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(root, `app.js.br${suffix}`)), { code: "ENOENT" });
  }
});
