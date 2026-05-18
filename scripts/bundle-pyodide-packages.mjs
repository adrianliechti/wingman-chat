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

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Extra PyPI packages (not built into Pyodide – installed via micropip)
// Their transitive dependencies are resolved automatically at bundle time.
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
  "pypdf",
  "reportlab",
  "markdown",
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
  "pyyaml",
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
      (u.filename.endsWith("-py3-none-any.whl") || u.filename.endsWith("-py2.py3-none-any.whl")),
  );
  if (!wheel) throw new Error(`No pure-Python wheel found for ${packageName}`);
  return { url: wheel.url, filename: wheel.filename, version: data.info.version };
}

/** Normalize PyPI package names to compare them (PEP 503). */
function normalizePkgName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/**
 * Parse core (non-extra, non-conditional) dependencies from requires_dist.
 * Skips entries with `extra ==` anywhere in the marker string, and
 * platform-specific markers that don't apply to Pyodide (wasm32).
 */
function parseCoreRequires(requiresDist) {
  if (!requiresDist) return [];
  const deps = [];
  for (const req of requiresDist) {
    // Extract the marker portion (everything after the first unquoted semicolon)
    const markerMatch = req.match(/;(.+)$/);
    if (markerMatch) {
      const marker = markerMatch[1];
      // Skip anything that requires a specific extra
      if (/extra\s*==/.test(marker)) continue;
      // Skip platform-specific markers that don't apply to Pyodide (wasm32)
      if (/(sys_platform|platform_system|os_name)\s*==/.test(marker)) continue;
    }
    // Extract the package name (first token before version specifiers / markers)
    const match = req.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)/);
    if (match) deps.push(normalizePkgName(match[1]));
  }
  return deps;
}

/**
 * Resolve transitive dependencies for all PyPI packages.
 * Returns:
 *   extraPyodideBuiltins: Pyodide built-ins that need to be bundled (union).
 *   extraPypiPackages: PyPI packages that need to be bundled (union).
 *   builtinDepsByPkg: per-PyPI-package map of transitive Pyodide-builtin deps,
 *     used at runtime to preload them via `pyodide.loadPackage()` before
 *     `micropip.install("/pyodide/<wheel>.whl")` — micropip won't auto-resolve
 *     these for a local-file wheel and the install will fail at import time.
 */
async function resolveTransitiveDeps(pypiPackages, pyodideLock, alreadyBundled) {
  const pyodidePkgNames = new Set(Object.keys(pyodideLock.packages).map(normalizePkgName));
  const findOriginalName = (dep) =>
    Object.keys(pyodideLock.packages).find((k) => normalizePkgName(k) === dep);

  const depsCache = new Map();
  async function fetchDeps(pkg) {
    if (depsCache.has(pkg)) return depsCache.get(pkg);
    let deps = [];
    try {
      const res = await fetch(`https://pypi.org/pypi/${pkg}/json`);
      if (res.ok) {
        const data = await res.json();
        deps = parseCoreRequires(data.info.requires_dist);
      }
    } catch {
      // network failure → treat as no deps
    }
    depsCache.set(pkg, deps);
    return deps;
  }

  // Phase 1: BFS the PyPI dep graph to find all packages to bundle (the union).
  const pypiSeen = new Set(pypiPackages.map(normalizePkgName));
  const builtinSeen = new Set(alreadyBundled.map(normalizePkgName));
  const extraPyodideBuiltins = [];
  const extraPypiPackages = [];
  const queue = pypiPackages.map(normalizePkgName);

  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dep of await fetchDeps(pkg)) {
      if (pyodidePkgNames.has(dep)) {
        if (builtinSeen.has(dep)) continue;
        builtinSeen.add(dep);
        const orig = findOriginalName(dep);
        if (orig) {
          extraPyodideBuiltins.push(orig);
          console.log(`  + ${orig} (Pyodide built-in, needed by ${pkg})`);
        }
      } else {
        if (pypiSeen.has(dep)) continue;
        pypiSeen.add(dep);
        extraPypiPackages.push(dep);
        queue.push(dep);
        console.log(`  + ${dep} (PyPI, needed by ${pkg})`);
      }
    }
  }

  // Phase 2: for each PyPI package, compute its transitive Pyodide-builtin
  // deps by walking the PyPI sub-graph rooted at the package and collecting
  // every built-in dep encountered along the way (direct or via another PyPI dep).
  const builtinDepsByPkg = {};
  for (const root of pypiSeen) {
    const visitedPypi = new Set();
    const stack = [root];
    const builtins = new Set();
    while (stack.length > 0) {
      const p = stack.pop();
      if (visitedPypi.has(p)) continue;
      visitedPypi.add(p);
      for (const dep of depsCache.get(p) || []) {
        if (pyodidePkgNames.has(dep)) {
          const orig = findOriginalName(dep);
          if (orig) builtins.add(orig);
        } else {
          stack.push(dep);
        }
      }
    }
    if (builtins.size > 0) builtinDepsByPkg[root] = [...builtins];
  }

  return { extraPyodideBuiltins, extraPypiPackages, builtinDepsByPkg };
}

// ---------------------------------------------------------------------------
// 1. Bundle Pyodide built-in wheels from CDN
// ---------------------------------------------------------------------------

async function bundlePyodideBuiltins() {
  console.log("Bundling Pyodide built-in packages from CDN...");

  const lockPath = path.resolve("node_modules/pyodide/pyodide-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const pyodideNpmVersion = JSON.parse(
    fs.readFileSync(path.resolve("node_modules/pyodide/package.json"), "utf8"),
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
  const expectedWheelFiles = new Set();

  fs.mkdirSync(PYODIDE_OUTPUT_DIR, { recursive: true });

  let downloaded = 0;
  let cached = 0;
  let redownloaded = 0;
  for (const name of [...allPkgs].sort()) {
    const pkg = lock.packages[name];
    expectedWheelFiles.add(pkg.file_name);
    const dest = path.join(PYODIDE_OUTPUT_DIR, pkg.file_name);

    // Pyodide and PyPI both ship same-named wheels for many packages with
    // different content (Pyodide patches some). Verify the cached file's
    // sha256 matches pyodide-lock.json — otherwise `pyodide.loadPackage()`
    // fails the integrity check silently and the package never installs.
    if (fs.existsSync(dest) && pkg.sha256) {
      const actual = crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
      if (actual === pkg.sha256) {
        cached++;
        continue;
      }
      console.log(`  ! ${name} sha256 mismatch (${actual.slice(0, 8)}… ≠ ${pkg.sha256.slice(0, 8)}…), re-downloading`);
      fs.unlinkSync(dest);
      redownloaded++;
    }

    const url = cdnBase + pkg.file_name;
    process.stdout.write(`  ↓ ${name} (${pkg.file_name}) ...`);
    await downloadFile(url, dest);
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

// ---------------------------------------------------------------------------
// 2. Bundle extra PyPI wheels
// ---------------------------------------------------------------------------

async function bundlePypiPackages(builtinDepsByPkg) {
  console.log("Bundling extra PyPI packages...");

  fs.mkdirSync(PYPI_OUTPUT_DIR, { recursive: true });
  const manifest = {};
  const expectedWheelFiles = new Set();

  for (const pkg of PYPI_PACKAGES) {
    const { url, filename, version } = await getLatestWheel(pkg);
    expectedWheelFiles.add(filename);
    const dest = path.join(PYPI_OUTPUT_DIR, filename);

    if (fs.existsSync(dest)) {
      console.log(`  ✓ ${pkg}@${version} (cached)`);
    } else {
      process.stdout.write(`  ↓ ${pkg}@${version} ...`);
      await downloadFile(url, dest);
      console.log(" done");
    }

    const builtinDeps = builtinDepsByPkg[normalizePkgName(pkg)] || [];
    manifest[pkg] = builtinDeps.length > 0 ? { filename, pyodideBuiltinDeps: builtinDeps } : { filename };
  }

  fs.writeFileSync(path.join(PYPI_OUTPUT_DIR, "pypi-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log("  Manifest written to", path.join(PYPI_OUTPUT_DIR, "pypi-manifest.json"));
  return expectedWheelFiles;
}

function pruneUnexpectedWheelFiles(expectedWheelFiles) {
  const staleWheelFiles = fs
    .readdirSync(PYODIDE_OUTPUT_DIR)
    .filter((file) => file.endsWith(".whl") && !expectedWheelFiles.has(file));

  for (const file of staleWheelFiles) {
    fs.unlinkSync(path.join(PYODIDE_OUTPUT_DIR, file));
    console.log(`  - removed stale wheel ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Copy the Pyodide runtime files (JS, WASM, stdlib) into public/pyodide/. */
function copyPyodideRuntime() {
  const pyodideDir = path.resolve("node_modules/pyodide");
  const outDir = PYODIDE_OUTPUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  const extensions = [".js", ".mjs", ".wasm", ".zip", ".json"];
  for (const file of fs.readdirSync(pyodideDir)) {
    if (extensions.some((ext) => file.endsWith(ext))) {
      fs.copyFileSync(path.join(pyodideDir, file), path.join(outDir, file));
    }
  }
}

async function main() {
  // Copy Pyodide runtime into public/pyodide/ for both dev and prod
  copyPyodideRuntime();

  // Resolve transitive dependencies of PyPI packages before bundling
  const lockPath = path.resolve("node_modules/pyodide/pyodide-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

  console.log("Resolving transitive dependencies of PyPI packages...");
  const { extraPyodideBuiltins, extraPypiPackages, builtinDepsByPkg } = await resolveTransitiveDeps(
    PYPI_PACKAGES,
    lock,
    PYODIDE_BUILTIN_TARGETS,
  );

  // Extend the target lists with discovered transitive deps
  for (const pkg of extraPyodideBuiltins) {
    if (!PYODIDE_BUILTIN_TARGETS.includes(pkg)) {
      PYODIDE_BUILTIN_TARGETS.push(pkg);
    }
  }
  for (const pkg of extraPypiPackages) {
    if (!PYPI_PACKAGES.includes(pkg)) {
      PYPI_PACKAGES.push(pkg);
    }
  }

  const builtinWheelFiles = await bundlePyodideBuiltins();
  const pypiWheelFiles = await bundlePypiPackages(builtinDepsByPkg);
  pruneUnexpectedWheelFiles(new Set([...builtinWheelFiles, ...pypiWheelFiles]));
  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
