#!/usr/bin/env node
/**
 * Downloads Python wheels for offline use into public/pyodide/:
 *   - Pyodide built-in wheels (numpy, pandas, …) from the Pyodide CDN.
 *     Hashes are verified against pyodide-lock.json on download and on cache.
 *   - Pure-Python PyPI wheels (seaborn, plotly, …) from PyPI.
 *     Hashes are verified against PyPI's published digests.sha256.
 *
 * The PyPI wheels aren't in Pyodide's lock, so we *inject* them into the copied
 * public/pyodide/pyodide-lock.json — synthesizing each entry's `imports` (from
 * the wheel contents), `depends` (from the resolved dep graph), version and
 * sha256. The runtime then loads them through Pyodide's normal lock-driven loader
 * (`loadPackagesFromImports` / `loadPackage`) exactly like the built-ins — no
 * separate manifest or micropip orchestration needed.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

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
  "tzdata",
  // Unvendored stdlib: Pyodide ships these as separately-loadable packages, not
  // in the base interpreter. Bundling them lets the runtime auto-load them on
  // `import sqlite3` / `ssl` / `lzma` (and tarfile/shutil .xz, TLS).
  // NOTE: `hashlib` is intentionally omitted — its package only registers the
  // private `_hashlib` import (OpenSSL extras), so `import hashlib` would never
  // auto-load it; base stdlib hashlib (all common digests + a pure-Python
  // pbkdf2_hmac fallback) is already built in.
  "sqlite3",
  "ssl",
  "lzma",
  // Data & document handling. xlrd/python-calamine read legacy .xls/.xlsb/.ods
  // that openpyxl can't; pydantic is ubiquitous for data modeling/validation.
  "xlrd",
  "python-calamine",
  "pydantic",
  // Image processing beyond Pillow.
  "opencv-python",
  "scikit-image",
  "imageio",
  // Gradient-boosting ML (complements scikit-learn / statsmodels).
  "xgboost",
  "lightgbm",
  // Commonly imported helpers. requests works only for CORS-permitted endpoints
  // in the worker sandbox (no general network), but importing it must not fail.
  "requests",
  "regex",
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
  // Pinned to the exact pdfminer.six pdfplumber depends on, so we bundle the
  // version it was tested against rather than whatever PyPI serves as latest.
  "pdfminer.six==20251230",
  "pdfplumber",
  "reportlab",
  "markdown",
  "markdownify",
  "tabulate",
  // Pin to last release before red-black-tree-mod was added — that dep only
  // ships as an sdist and our bundler only handles pure-Python wheels.
  "extract-msg==0.36.5",
];

// Native-binary deps that have no pure wheel but are only imported lazily by
// their dependents for features we don't use. We bundle the dependent anyway and
// simply omit these from its `depends`, so Pyodide's loader never tries to fetch
// them; the lazy `import` only fires for the unused feature. Names must be PEP
// 503 normalized.
//   pypdfium2 — pdfplumber needs it only for page.to_image() rendering, not for
//               extract_text()/extract_tables().
//   kaleido   — plotly static image export; our PLOTLY_IMAGE_SHIM renders instead.
const MOCKED_NATIVE_DEPS = new Set(["pypdfium2", "kaleido"]);

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
 *   builtins:        full set of Pyodide built-ins to bundle (lockfile names)
 *   pypi:            full set of pure PyPI packages to bundle (normalized)
 *   directDepsByPkg: per-PyPI-package *direct* deps (lock keys), for that
 *                    package's `depends` field in the lock. Pyodide's loader
 *                    walks `depends` itself, so direct (not transitive) is right.
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
      if (MOCKED_NATIVE_DEPS.has(dep)) continue; // native dep we omit; see MOCKED_NATIVE_DEPS
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

  // Phase 2: each PyPI package's direct deps, as lock keys, for its `depends`.
  // Drop native deps we mock-omit and self-references; everything else is bundled
  // (a built-in already in the lock, or another injected PyPI package).
  const directDepsByPkg = {};
  for (const pkg of pypi) {
    const deps = new Set();
    for (const dep of depsCache.get(pkg) || []) {
      if (MOCKED_NATIVE_DEPS.has(dep) || dep === pkg) continue;
      if (isBuiltin(dep)) deps.add(builtinOriginal(dep));
      else if (pypi.has(dep)) deps.add(dep);
    }
    directDepsByPkg[pkg] = [...deps];
  }

  return {
    builtins: [...builtins].map(builtinOriginal),
    pypi: [...pypi],
    directDepsByPkg,
  };
}

/**
 * Top-level importable names of a wheel — what `top_level.txt` would contain
 * (used to build the lock's `imports` field so `loadPackagesFromImports` can map
 * `import bs4` → beautifulsoup4). Many modern wheels omit `top_level.txt`, so we
 * derive from the always-present file listing: a dir with `__init__.py` is a
 * package, a top-level `*.py` is a module; `.dist-info`/`.data` are skipped.
 */
async function extractWheelImports(buffer, label) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);

  const topLevelTxt = names.find((n) => /\.dist-info\/top_level\.txt$/.test(n));
  if (topLevelTxt) {
    const text = await zip.files[topLevelTxt].async("string");
    const mods = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (mods.length) return [...new Set(mods)];
  }

  const imports = new Set();
  for (const n of names) {
    const seg = n.split("/")[0];
    if (!seg || seg.endsWith(".dist-info") || seg.endsWith(".data")) continue;
    if (n === `${seg}/__init__.py`) imports.add(seg);
    else if (n === seg && seg.endsWith(".py")) imports.add(seg.slice(0, -3));
  }
  if (imports.size === 0) throw new Error(`could not determine import names for ${label}`);
  return [...imports];
}

// --- Wheel bundling ---------------------------------------------------------

async function bundlePyodideBuiltins(builtinTargets, pyodideLock, cdnBase) {
  console.log("Bundling Pyodide built-in packages from CDN...");

  // Pyodide's lock lists some `depends` with underscores (e.g. `pydantic_core`,
  // `lazy_loader`) while the keys are dash-normalized (`pydantic-core`); resolve
  // through a normalized index so those transitive deps actually get bundled.
  const keyByNormalized = new Map(Object.keys(pyodideLock.packages).map((n) => [normalizePkgName(n), n]));
  const allPkgs = new Set();
  function collect(name) {
    const key = keyByNormalized.get(normalizePkgName(name));
    if (!key) {
      console.warn(`  ⚠ ${name} not found in pyodide-lock.json, skipping`);
      return;
    }
    if (allPkgs.has(key)) return;
    allPkgs.add(key);
    for (const dep of pyodideLock.packages[key].depends || []) collect(dep);
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

async function bundlePypiWheels(pypiPackages, directDepsByPkg) {
  console.log("Bundling extra PyPI packages...");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const entries = [];
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

    const buffer = fs.readFileSync(dest);
    const key = normalizePkgName(pkg);
    // Lock entry mirrors how Pyodide describes its own pure-Python packages.
    entries.push({
      name: key,
      version: wheel.version,
      file_name: wheel.filename,
      install_dir: "site",
      sha256: wheel.sha256 ?? sha256(buffer),
      package_type: "package",
      imports: await extractWheelImports(buffer, label),
      depends: directDepsByPkg[key] ?? [],
      unvendored_tests: false,
    });
  }

  return { entries, expectedWheelFiles };
}

/** Add the bundled PyPI packages to the copied lock so Pyodide can load them. */
function injectPypiIntoLock(entries) {
  const lockPath = path.join(OUTPUT_DIR, "pyodide-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  for (const entry of entries) {
    if (lock.packages[entry.name]) console.warn(`  ⚠ overwriting existing lock entry for ${entry.name}`);
    lock.packages[entry.name] = entry;
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock)}\n`);
  console.log(`  Injected ${entries.length} PyPI packages into pyodide-lock.json`);
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
  const { builtins, pypi, directDepsByPkg } = await resolveTransitiveDeps(
    pypiNames,
    pyodideLock,
    PYODIDE_BUILTIN_TARGETS,
  );

  const builtinWheelFiles = await bundlePyodideBuiltins(builtins, pyodideLock, cdnBase);
  const { entries, expectedWheelFiles: pypiWheelFiles } = await bundlePypiWheels(pypi, directDepsByPkg);
  injectPypiIntoLock(entries);
  pruneUnexpectedWheelFiles(new Set([...builtinWheelFiles, ...pypiWheelFiles]));

  // Remove the manifest from the previous (micropip-based) scheme if present.
  const staleManifest = path.join(OUTPUT_DIR, "pypi-manifest.json");
  if (fs.existsSync(staleManifest)) {
    fs.unlinkSync(staleManifest);
    console.log("  - removed stale pypi-manifest.json");
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
