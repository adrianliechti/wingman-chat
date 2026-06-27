#!/usr/bin/env node
/**
 * Offline end-to-end test of the bundled Pyodide distribution in public/pyodide/.
 *
 * Boots a real Pyodide runtime in Node pointed at the bundle (indexURL), then
 * loads packages purely from the (injected) pyodide-lock.json — no network, no
 * micropip. The `loadFor` helper mirrors the worker's loading strategy
 * (loadPackagesFromImports + tzdata detection + explicit extras), so this also
 * exercises that strategy, not just the lock. Proves that:
 *   - base-interpreter stdlib (sqlite3, ssl, lzma) imports with nothing to load
 *   - tzdata is pulled in for zoneinfo/pandas tz use (never imported by name)
 *   - injected PyPI wheels resolve by import name (incl. import≠pkg, e.g. docx)
 *   - their `depends` graph (PyPI→PyPI and PyPI→builtin) resolves from the lock
 *   - native deps we exclude (pypdfium2, kaleido) don't block loading
 *
 * Run after `npm run bundle:pyodide`:  node scripts/test-pyodide-bundle.mjs
 *
 * Heavy packages (numpy/scipy, opencv, scikit-image, xgboost, lightgbm) load
 * large wheels on first import; pass --light to skip them for a fast smoke test.
 */

import path from "node:path";
import { loadPyodide } from "pyodide";

const indexURL = `${path.resolve("public/pyodide")}/`;
const light = process.argv.includes("--light");

// Keep in sync with TZDATA_USAGE in interpreter.worker.ts.
const TZDATA_USAGE = /\bzoneinfo\b|\bZoneInfo\(|\.tz_localize\(|\.tz_convert\(|\btz\s*=\s*['"]/;

// [name, code, { extras?, heavy? }]
const CASES = [
  // --- Base-interpreter stdlib (built in since Pyodide 314, no loading) ---
  ["stdlib sqlite3", "import sqlite3\nc=sqlite3.connect(':memory:')\nc.execute('create table t(x)')\nc.execute('insert into t values(42)')\nc.execute('select x from t').fetchone()[0]"],
  ["stdlib ssl", "import ssl\nssl.create_default_context() is not None"],
  ["stdlib lzma", "import lzma\nlzma.decompress(lzma.compress(b'x'*200))==b'x'*200"],
  // Base stdlib hashlib ships the common digests + a pure-Python pbkdf2_hmac;
  // the OpenSSL-backed digests/HMAC dropped in Pyodide 314 are not available.
  ["stdlib hashlib (base digests)", "import hashlib\nhashlib.sha256(b'abc').hexdigest()[:8]"],

  // --- tzdata / zoneinfo (data-only; loadFor must detect it) ---
  ["tzdata via zoneinfo", "from zoneinfo import ZoneInfo\nfrom datetime import datetime\ndatetime(2026,6,14,tzinfo=ZoneInfo('Europe/Zurich')).utcoffset() is not None"],

  // --- Core data stack ---
  ["numpy + pandas", "import numpy as np, pandas as pd\nint(pd.DataFrame({'a':np.arange(5)})['a'].sum())", { heavy: true }],
  ["pandas tz_convert (tzdata)", "import pandas as pd\nstr(pd.Timestamp('2026-06-14 12:00').tz_localize('Europe/Zurich').tz_convert('UTC').tz)", { heavy: true }],

  // --- Validation ---
  ["pydantic v2", "from pydantic import BaseModel\nclass M(BaseModel):\n  x:int\nM(x='5').x"],

  // --- Spreadsheets / documents ---
  ["openpyxl (+ et-xmlfile)", "import openpyxl\nopenpyxl.__version__"],
  ["xlrd", "import xlrd\nhasattr(xlrd,'open_workbook')"],
  ["python-calamine", "import python_calamine\nhasattr(python_calamine,'CalamineWorkbook')"],
  ["import docx → python-docx", "import docx\ndocx.__version__"],
  ["pdfplumber → pdfminer-six → cryptography", "import pdfplumber\npdfplumber.__version__"],
  ["markdownify (+ markdown, bs4)", "import markdownify\nmarkdownify.markdownify('<b>x</b>')"],
  // extract-msg pulls rtfde → oletools; a cyclic oletools↔pcodedmp edge in the
  // lock makes this import hang forever (the bug PRUNED_DEPS fixes), so a clean
  // import here proves the chain resolves.
  ["import extract_msg (.msg → rtfde → oletools)", "import extract_msg\nextract_msg.__version__"],

  // --- Images (heavy) ---
  ["opencv (cv2)", "import cv2, numpy as np\ncv2.cvtColor(np.zeros((4,4,3),np.uint8),cv2.COLOR_BGR2GRAY).shape==(4,4)", { heavy: true }],
  ["scikit-image", "import numpy as np\nfrom skimage.filters import gaussian\ngaussian(np.zeros((8,8)),sigma=1).shape==(8,8)", { heavy: true }],
  ["imageio png (+ Pillow)", "import PIL, numpy as np\nimport imageio.v3 as iio\nb=iio.imwrite('<bytes>',np.zeros((8,8,3),'uint8'),extension='.png')\niio.imread(b).shape[:2]==(8,8)", { heavy: true }],

  // --- ML (heavy) ---
  ["xgboost", "import numpy as np, xgboost as xgb\nr=np.random.default_rng(0); X=r.random((40,3)); y=(X[:,0]>.5).astype(int)\nbool(xgb.train({'objective':'binary:logistic','max_depth':2}, xgb.DMatrix(X,label=y), num_boost_round=2).predict(xgb.DMatrix(X)).shape==(40,))", { heavy: true }],
  ["lightgbm", "import numpy as np, lightgbm as lgb\nr=np.random.default_rng(0); X=r.random((60,3)); y=(X[:,0]>.5).astype(int)\nbool(lgb.train({'objective':'binary','num_leaves':5,'verbose':-1}, lgb.Dataset(X,label=y), num_boost_round=3).predict(X).shape==(60,))", { heavy: true }],

  // --- Misc helpers ---
  ["regex (unicode props)", "import regex\nbool(regex.fullmatch(r'\\p{Greek}+','αβγ'))"],
  ["requests import (no network)", "import requests\nhasattr(requests,'get')"],

  // --- Explicit `packages` arg path (tolerant): junk name must not abort ---
  ["explicit junk pkg tolerated", "1+1", { extras: ["json", "definitely-not-a-real-pkg"] }],
];

const py = await loadPyodide({ indexURL });
const warn = (m) => console.warn(`  [warn] ${m}`);

// Mirrors interpreter.worker.ts: imports auto-load; tzdata + explicit extras are
// loaded tolerantly on top.
async function loadFor(code, extras = []) {
  await py.loadPackagesFromImports(code, { errorCallback: warn });
  const pkgs = new Set(extras);
  if (TZDATA_USAGE.test(code)) pkgs.add("tzdata");
  for (const pkg of pkgs) {
    try {
      await py.loadPackage(pkg, { errorCallback: warn });
    } catch (err) {
      console.warn(`  skipped ${pkg}: ${err}`);
    }
  }
}

let passed = 0;
let skipped = 0;
for (const [name, code, opts = {}] of CASES) {
  if (light && opts.heavy) {
    console.log(`SKIP  ${name} (--light)`);
    skipped++;
    continue;
  }
  try {
    await loadFor(code, opts.extras);
    const result = await py.runPythonAsync(code);
    console.log(`PASS  ${name} -> ${String(result).trim()}`);
    passed++;
  } catch (err) {
    const tail = String(err).split("\n").slice(-3).join(" | ");
    console.log(`FAIL  ${name}: ${tail}`);
  }
}

const expected = CASES.length - skipped;
console.log(`\n${passed}/${expected} passed${skipped ? ` (${skipped} skipped)` : ""}`);
process.exit(passed === expected ? 0 : 1);
