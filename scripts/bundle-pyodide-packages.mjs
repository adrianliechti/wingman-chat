#!/usr/bin/env node
/**
 * Downloads Python wheels for offline use:
 *
 * 1. Pyodide built-in packages (numpy, micropip, etc.) from the Pyodide CDN
 *    → placed in public/pyodide/ alongside the core runtime files
 *
 * 2. Extra pure-Python packages from PyPI (seaborn, plotly, etc.)
 *    → placed in public/pyodide-packages/ for micropip to install at runtime
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Extra PyPI packages (not built into Pyodide – installed via micropip)
// ---------------------------------------------------------------------------
const PYPI_PACKAGES = [
  "seaborn",
  "tenacity",
  "plotly",
  "et-xmlfile",
  "openpyxl",
  "xlsxwriter",
  "python-docx",
  "python-pptx",
  "docx2txt",
];
const PYPI_OUTPUT_DIR = "public/pyodide";

// ---------------------------------------------------------------------------
// Pyodide built-in packages to bundle (loaded via pyodide.loadPackage)
// Their transitive dependencies are resolved from pyodide-lock.json.
// ---------------------------------------------------------------------------
const PYODIDE_BUILTIN_TARGETS = [
  "micropip",
  "numpy",
  "pandas",
  "matplotlib",
  "scipy",
  "scikit-learn",
  "statsmodels",
  "sympy",
  "networkx",
  "pillow",
  "pyarrow",
  "beautifulsoup4",
  "lxml",
  "sqlalchemy",
  "packaging",
  "typing-extensions",
  "six",
];
const PYODIDE_OUTPUT_DIR = "public/pyodide";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
}

async function getLatestWheel(packageName) {
  const res = await fetch(`https://pypi.org/pypi/${packageName}/json`);
  if (!res.ok) throw new Error(`PyPI lookup failed for ${packageName}: ${res.status}`);
  const data = await res.json();

  const wheel = data.urls.find(
    (u) =>
      u.packagetype === "bdist_wheel" &&
      (u.filename.endsWith("-py3-none-any.whl") ||
        u.filename.endsWith("-py2.py3-none-any.whl"))
  );
  if (!wheel) throw new Error(`No pure-Python wheel found for ${packageName}`);
  return { url: wheel.url, filename: wheel.filename, version: data.info.version };
}

// ---------------------------------------------------------------------------
// 1. Bundle Pyodide built-in wheels from CDN
// ---------------------------------------------------------------------------

async function bundlePyodideBuiltins() {
  console.log("Bundling Pyodide built-in packages from CDN...");

  const lockPath = path.resolve("node_modules/pyodide/pyodide-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const pyodideNpmVersion = JSON.parse(
    fs.readFileSync(path.resolve("node_modules/pyodide/package.json"), "utf8")
  ).version;
  const cdnBase = `https://cdn.jsdelivr.net/pyodide/v${pyodideNpmVersion}/full/`;

  // Resolve full dependency tree
  const allPkgs = new Set();
  function collect(name) {
    if (allPkgs.has(name)) return;
    const pkg = lock.packages[name];
    if (!pkg) {
      console.warn(`  ⚠ ${name} not found in pyodide-lock.json, skipping`);
      return;
    }
    allPkgs.add(name);
    for (const dep of pkg.depends || []) collect(dep);
  }
  PYODIDE_BUILTIN_TARGETS.forEach(collect);

  fs.mkdirSync(PYODIDE_OUTPUT_DIR, { recursive: true });

  let downloaded = 0;
  let cached = 0;
  for (const name of [...allPkgs].sort()) {
    const pkg = lock.packages[name];
    const dest = path.join(PYODIDE_OUTPUT_DIR, pkg.file_name);

    if (fs.existsSync(dest)) {
      cached++;
      continue;
    }

    const url = cdnBase + pkg.file_name;
    process.stdout.write(`  ↓ ${name} (${pkg.file_name}) ...`);
    await downloadFile(url, dest);
    console.log(" done");
    downloaded++;
  }

  console.log(
    `  ${allPkgs.size} packages resolved (${downloaded} downloaded, ${cached} cached)`
  );
}

// ---------------------------------------------------------------------------
// 2. Bundle extra PyPI wheels
// ---------------------------------------------------------------------------

async function bundlePypiPackages() {
  console.log("Bundling extra PyPI packages...");

  fs.mkdirSync(PYPI_OUTPUT_DIR, { recursive: true });
  const manifest = {};

  for (const pkg of PYPI_PACKAGES) {
    const { url, filename, version } = await getLatestWheel(pkg);
    const dest = path.join(PYPI_OUTPUT_DIR, filename);

    if (fs.existsSync(dest)) {
      console.log(`  ✓ ${pkg}@${version} (cached)`);
    } else {
      process.stdout.write(`  ↓ ${pkg}@${version} ...`);
      await downloadFile(url, dest);
      console.log(" done");
    }

    manifest[pkg] = filename;
  }

  fs.writeFileSync(
    path.join(PYPI_OUTPUT_DIR, "pypi-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  console.log("  Manifest written to", path.join(PYPI_OUTPUT_DIR, "pypi-manifest.json"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await bundlePyodideBuiltins();
  await bundlePypiPackages();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
