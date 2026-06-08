#!/usr/bin/env node
/**
 * Downloads Python wheels for offline use into public/pyodide/:
 *   - Pyodide built-in wheels (numpy, pandas, …) from the Pyodide CDN.
 *     Hashes are verified against pyodide-lock.json on download and on cache.
 *   - Pure-Python PyPI wheels (seaborn, plotly, …) from PyPI.
 *     Hashes are verified against PyPI's published digests.sha256.
 *
 * Writes pypi-manifest.json so the runtime loader knows:
 *   - which Pyodide built-ins to preload via `pyodide.loadPackage()`
 *   - which sibling PyPI wheels to install in the same `micropip.install()`
 *     batch (otherwise micropip falls back to fetching them from pypi.org).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// --- Config -----------------------------------------------------------------

const OUTPUT_DIR = "public/pyodide";

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
  "pyyaml",
];

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
  "pypdf",
  "pdfminer.six",
  "reportlab",
  "markdown",
  "markdownify",
  "tabulate",
  // Pin to last release before red-black-tree-mod was added — that dep only
  // ships as an sdist and our bundler only handles pure-Python wheels.
  "extract-msg==0.36.5",
];

// --- Helpers ----------------------------------------------------------------

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/** Normalize PyPI distribution names per PEP 503. */
const normalizePkgName = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

async function downloadFile(url, dest, expectedSha256) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (expectedSha256) {
    const actual = sha256(buffer);
    if (actual !== expectedSha256) {
      throw new Error(`sha256 mismatch for ${url}: got ${actual}, expected ${expectedSha256}`);
    }
  }
  fs.writeFileSync(dest, buffer);
}

/**
 * Returns "cached" if dest exists and matches expectedSha256 (or no hash given),
 * "mismatch" if dest exists but the hash differs (and removes the bad file),
 * "missing" if dest doesn't exist.
 */
function checkCache(dest, expectedSha256, label) {
  if (!fs.existsSync(dest)) return "missing";
  if (!expectedSha256) return "cached";
  const actual = sha256(fs.readFileSync(dest));
  if (actual === expectedSha256) return "cached";
  console.log(`  ! ${label} sha256 mismatch (${actual.slice(0, 8)}… ≠ ${expectedSha256.slice(0, 8)}…), re-downloading`);
  fs.unlinkSync(dest);
  return "mismatch";
}

/** Parse "pkg" or "pkg==X.Y.Z" into { name, version }. Only `==` is supported. */
function parsePackageSpec(spec) {
  const idx = spec.indexOf("==");
  if (idx === -1) return { name: spec.trim(), version: undefined };
  return { name: spec.slice(0, idx).trim(), version: spec.slice(idx + 2).trim() };
}

// Override map: normalized-name → pinned version. Populated as user-supplied
// "pkg==X.Y.Z" entries are parsed, so transitive lookups for the same package
// honour the pin too.
const versionPins = new Map();

const pypiMetadataCache = new Map();
async function fetchPypiMetadata(packageName) {
  if (pypiMetadataCache.has(packageName)) return pypiMetadataCache.get(packageName);
  const pinned = versionPins.get(normalizePkgName(packageName));
  const url = pinned
    ? `https://pypi.org/pypi/${packageName}/${pinned}/json`
    : `https://pypi.org/pypi/${packageName}/json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PyPI lookup failed for ${packageName}${pinned ? `==${pinned}` : ""}: ${res.status}`);
  const data = await res.json();
  pypiMetadataCache.set(packageName, data);
  return data;
}

function pickPureWheel(packageName, data) {
  const wheel = data.urls.find(
    (u) =>
      u.packagetype === "bdist_wheel" &&
      (u.filename.endsWith("-py3-none-any.whl") || u.filename.endsWith("-py2.py3-none-any.whl")),
  );
  if (!wheel) throw new Error(`No pure-Python wheel found for ${packageName}`);
  return {
    url: wheel.url,
    filename: wheel.filename,
    version: data.info.version,
    sha256: wheel.digests?.sha256,
  };
}

/**
 * Parse core (non-extra, non-conditional) dependencies from requires_dist.
 * Skips entries with `extra ==` and platform-pinned markers — Pyodide runs as
 * `sys_platform == "emscripten"`, so any dep gated to win32/linux/darwin can
 * be omitted from the bundle.
 */
function parseCoreRequires(requiresDist) {
  if (!requiresDist) return [];
  const deps = [];
  for (const req of requiresDist) {
    const markerMatch = req.match(/;(.+)$/);
    if (markerMatch) {
      const marker = markerMatch[1];
      if (/extra\s*==/.test(marker)) continue;
      if (/(sys_platform|platform_system|os_name)\s*==/.test(marker)) continue;
    }
    const match = req.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)/);
    if (match) deps.push(normalizePkgName(match[1]));
  }
  return deps;
}

// --- Dependency resolution --------------------------------------------------

/**
 * Walks the PyPI dep graph rooted at `pypiPackages` and returns:
 *   builtins:         full set of Pyodide built-ins to bundle (lockfile names)
 *   pypi:             full set of pure PyPI packages to bundle (normalized)
 *   builtinDepsByPkg: per-PyPI-package transitive built-in deps. Runtime
 *                     preloads these via `pyodide.loadPackage` before
 *                     `micropip.install` so micropip resolves them locally.
 *   pypiDepsByPkg:    per-PyPI-package transitive *PyPI* deps. Runtime adds
 *                     these to the same `micropip.install` batch — otherwise
 *                     micropip falls back to fetching them from pypi.org.
 */
async function resolveTransitiveDeps(pypiPackages, pyodideLock, builtinTargets) {
  const lockNameByNormalized = new Map(Object.keys(pyodideLock.packages).map((n) => [normalizePkgName(n), n]));
  const isBuiltin = (dep) => lockNameByNormalized.has(dep);
  const builtinOriginal = (dep) => lockNameByNormalized.get(dep);

  const depsCache = new Map();
  async function fetchDeps(pkg) {
    if (depsCache.has(pkg)) return depsCache.get(pkg);
    let deps = [];
    try {
      const data = await fetchPypiMetadata(pkg);
      deps = parseCoreRequires(data.info.requires_dist);
    } catch (err) {
      console.warn(`  ⚠ failed to fetch deps for ${pkg}: ${err.message} (treating as no deps)`);
    }
    depsCache.set(pkg, deps);
    return deps;
  }

  // Validate user-supplied built-ins against the lockfile up front — a typo
  // here would otherwise silently produce a smaller bundle than intended.
  const builtins = new Set();
  for (const target of builtinTargets) {
    const normalized = normalizePkgName(target);
    if (isBuiltin(normalized)) {
      builtins.add(normalized);
    } else {
      console.warn(`  ⚠ ${target} not found in pyodide-lock.json, skipping`);
    }
  }

  // Phase 1: BFS the PyPI dep graph to find the full set to bundle.
  const pypi = new Set(pypiPackages.map(normalizePkgName));
  const queue = [...pypi];

  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dep of await fetchDeps(pkg)) {
      if (isBuiltin(dep)) {
        if (!builtins.has(dep)) {
          builtins.add(dep);
          console.log(`  + ${builtinOriginal(dep)} (Pyodide built-in, needed by ${pkg})`);
        }
      } else if (!pypi.has(dep)) {
        pypi.add(dep);
        queue.push(dep);
        console.log(`  + ${dep} (PyPI, needed by ${pkg})`);
      }
    }
  }

  // Phase 2: per-root sub-graph walk, splitting transitive deps into the
  // two buckets the runtime loader needs.
  const builtinDepsByPkg = {};
  const pypiDepsByPkg = {};
  for (const root of pypi) {
    const visited = new Set();
    const stack = [root];
    const builtinDeps = new Set();
    const pypiDeps = new Set();
    while (stack.length > 0) {
      const p = stack.pop();
      if (visited.has(p)) continue;
      visited.add(p);
      for (const dep of depsCache.get(p) || []) {
        if (isBuiltin(dep)) {
          builtinDeps.add(builtinOriginal(dep));
        } else if (dep !== root) {
          pypiDeps.add(dep);
          stack.push(dep);
        }
      }
    }
    if (builtinDeps.size > 0) builtinDepsByPkg[root] = [...builtinDeps];
    if (pypiDeps.size > 0) pypiDepsByPkg[root] = [...pypiDeps];
  }

  return {
    builtins: [...builtins].map(builtinOriginal),
    pypi: [...pypi],
    builtinDepsByPkg,
    pypiDepsByPkg,
  };
}

// --- Wheel bundling ---------------------------------------------------------

async function bundlePyodideBuiltins(builtinTargets, pyodideLock, cdnBase) {
  console.log("Bundling Pyodide built-in packages from CDN...");

  const allPkgs = new Set();
  function collect(name) {
    if (allPkgs.has(name)) return;
    const pkg = pyodideLock.packages[name];
    if (!pkg) {
      console.warn(`  ⚠ ${name} not found in pyodide-lock.json, skipping`);
      return;
    }
    allPkgs.add(name);
    for (const dep of pkg.depends || []) collect(dep);
  }
  builtinTargets.forEach(collect);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const expectedWheelFiles = new Set();
  let downloaded = 0,
    cached = 0,
    redownloaded = 0;

  for (const name of [...allPkgs].sort()) {
    const pkg = pyodideLock.packages[name];
    expectedWheelFiles.add(pkg.file_name);
    const dest = path.join(OUTPUT_DIR, pkg.file_name);

    // Pyodide and PyPI both ship same-named wheels for many packages with
    // different content (Pyodide patches some). Verifying the cached file
    // matches pyodide-lock.json is what stops `pyodide.loadPackage()` from
    // failing its own integrity check later (silently — it logs and returns).
    const state = checkCache(dest, pkg.sha256, name);
    if (state === "cached") {
      cached++;
      continue;
    }
    if (state === "mismatch") redownloaded++;

    const url = cdnBase + pkg.file_name;
    process.stdout.write(`  ↓ ${name} (${pkg.file_name}) ...`);
    await downloadFile(url, dest, pkg.sha256);
    console.log(" done");
    downloaded++;
  }

  console.log(
    `  ${allPkgs.size} packages resolved (${downloaded} downloaded${
      redownloaded > 0 ? `, ${redownloaded} re-downloaded after sha mismatch` : ""
    }, ${cached} cached)`,
  );
  return expectedWheelFiles;
}

async function bundlePypiPackages(pypiPackages, builtinDepsByPkg, pypiDepsByPkg) {
  console.log("Bundling extra PyPI packages...");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifest = {};
  const expectedWheelFiles = new Set();

  for (const pkg of pypiPackages) {
    const wheel = pickPureWheel(pkg, await fetchPypiMetadata(pkg));
    expectedWheelFiles.add(wheel.filename);
    const dest = path.join(OUTPUT_DIR, wheel.filename);
    const label = `${pkg}@${wheel.version}`;

    if (checkCache(dest, wheel.sha256, label) === "cached") {
      console.log(`  ✓ ${label} (cached)`);
    } else {
      process.stdout.write(`  ↓ ${label} ...`);
      await downloadFile(wheel.url, dest, wheel.sha256);
      console.log(" done");
    }

    const key = normalizePkgName(pkg);
    const entry = { filename: wheel.filename };
    if (builtinDepsByPkg[key]?.length) entry.pyodideBuiltinDeps = builtinDepsByPkg[key];
    if (pypiDepsByPkg[key]?.length) entry.pyodidePypiDeps = pypiDepsByPkg[key];
    manifest[key] = entry;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "pypi-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("  Manifest written to", path.join(OUTPUT_DIR, "pypi-manifest.json"));
  return expectedWheelFiles;
}

// --- Main -------------------------------------------------------------------

function copyPyodideRuntime() {
  const pyodideDir = path.resolve("node_modules/pyodide");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const extensions = [".js", ".mjs", ".wasm", ".zip", ".json"];
  for (const file of fs.readdirSync(pyodideDir)) {
    if (extensions.some((ext) => file.endsWith(ext))) {
      fs.copyFileSync(path.join(pyodideDir, file), path.join(OUTPUT_DIR, file));
    }
  }
}

function pruneUnexpectedWheelFiles(expectedWheelFiles) {
  for (const file of fs.readdirSync(OUTPUT_DIR)) {
    if (file.endsWith(".whl") && !expectedWheelFiles.has(file)) {
      fs.unlinkSync(path.join(OUTPUT_DIR, file));
      console.log(`  - removed stale wheel ${file}`);
    }
  }
}

async function main() {
  copyPyodideRuntime();

  const pyodideLock = JSON.parse(fs.readFileSync(path.resolve("node_modules/pyodide/pyodide-lock.json"), "utf8"));
  const pyodideNpmVersion = JSON.parse(
    fs.readFileSync(path.resolve("node_modules/pyodide/package.json"), "utf8"),
  ).version;
  const cdnBase = `https://cdn.jsdelivr.net/pyodide/v${pyodideNpmVersion}/full/`;

  const pypiNames = [];
  for (const spec of PYPI_PACKAGES) {
    const { name, version } = parsePackageSpec(spec);
    if (version) versionPins.set(normalizePkgName(name), version);
    pypiNames.push(name);
  }

  console.log("Resolving transitive dependencies of PyPI packages...");
  const { builtins, pypi, builtinDepsByPkg, pypiDepsByPkg } = await resolveTransitiveDeps(
    pypiNames,
    pyodideLock,
    PYODIDE_BUILTIN_TARGETS,
  );

  const builtinWheelFiles = await bundlePyodideBuiltins(builtins, pyodideLock, cdnBase);
  const pypiWheelFiles = await bundlePypiPackages(pypi, builtinDepsByPkg, pypiDepsByPkg);
  pruneUnexpectedWheelFiles(new Set([...builtinWheelFiles, ...pypiWheelFiles]));
  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
