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
 * Returns { extraPyodideBuiltins: string[], extraPypiPackages: string[] }
 * — packages that need to be bundled but aren't already listed.
 */
async function resolveTransitiveDeps(pypiPackages, pyodideLock, alreadyBundled) {
  const pyodidePkgNames = new Set(
    Object.keys(pyodideLock.packages).map(normalizePkgName)
  );

  const visited = new Set(pypiPackages.map(normalizePkgName));
  for (const name of alreadyBundled) visited.add(normalizePkgName(name));

  const extraPyodideBuiltins = [];
  const extraPypiPackages = [];
  const queue = [...pypiPackages];

  while (queue.length > 0) {
    const pkg = queue.shift();
    let coreDeps;
    try {
      const res = await fetch(`https://pypi.org/pypi/${pkg}/json`);
      if (!res.ok) continue;
      const data = await res.json();
      coreDeps = parseCoreRequires(data.info.requires_dist);
    } catch {
      continue;
    }

    for (const dep of coreDeps) {
      if (visited.has(dep)) continue;
      visited.add(dep);

      if (pyodidePkgNames.has(dep)) {
        // Available as a Pyodide built-in — make sure it gets bundled
        const originalName = Object.keys(pyodideLock.packages).find(
          (k) => normalizePkgName(k) === dep
        );
        if (originalName) {
          extraPyodideBuiltins.push(originalName);
          console.log(`  + ${originalName} (Pyodide built-in, needed by ${pkg})`);
        }
      } else {
        // Not in Pyodide — need to bundle from PyPI
        extraPypiPackages.push(dep);
        queue.push(dep); // recurse into this dep's own deps
        console.log(`  + ${dep} (PyPI, needed by ${pkg})`);
      }
    }
  }

  return { extraPyodideBuiltins, extraPypiPackages };
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
  // Resolve transitive dependencies of PyPI packages before bundling
  const lockPath = path.resolve("node_modules/pyodide/pyodide-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

  console.log("Resolving transitive dependencies of PyPI packages...");
  const { extraPyodideBuiltins, extraPypiPackages } = await resolveTransitiveDeps(
    PYPI_PACKAGES,
    lock,
    PYODIDE_BUILTIN_TARGETS
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

  await bundlePyodideBuiltins();
  await bundlePypiPackages();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
