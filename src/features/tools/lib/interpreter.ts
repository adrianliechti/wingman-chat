import { loadPyodide as loadPyodideRuntime, type PyodideInterface } from "pyodide";
import { bytesToDataUrl, dataUrlToBytes, isDataUrl } from "@/shared/lib/fileContent";
import { SANDBOX_HOME } from "@/shared/lib/sandbox";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { runLlm } from "./llmCommand";
import { clearRenderQueue, processRenderQueue } from "./plotlyRenderer";
import PLOTLY_IMAGE_SHIM from "./plotlyShim.py?raw";

interface ArtifactFile {
  content: string;
  contentType?: string;
}

type ArtifactFiles = Record<string, ArtifactFile>;

// Maps Python import names to pip package names — only needed for PyPI-manifest
// packages where the import name differs from the pip name.  Pyodide builtins
// (PIL→pillow, bs4→beautifulsoup4, …) are resolved automatically by loadPackage.
const PACKAGE_ALIASES: Record<string, string> = {
  docx: "python-docx",
  pptx: "python-pptx",
};

// Packages that cannot run in Pyodide (native binaries) — silently ignored when requested.
const IGNORED_PACKAGES = new Set(["kaleido"]);

const NO_OUTPUT_MESSAGE = "Code executed successfully (no output)";

function normalizePackageName(name: string): string {
  const lower = name.trim().toLowerCase();
  if (!lower) return lower;
  const root = lower.split(".")[0];
  return PACKAGE_ALIASES[lower] ?? PACKAGE_ALIASES[root] ?? root;
}

// Manifest mapping package names to local wheel filenames (built at compile time)
let wheelManifest: Record<string, string> | null = null;
async function getWheelManifest(): Promise<Record<string, string>> {
  if (wheelManifest) return wheelManifest;

  const res = await fetch("/pyodide/pypi-manifest.json");
  if (!res.ok) throw new Error(`Failed to load bundled package manifest: ${res.status}`);
  wheelManifest = (await res.json()) as Record<string, string>;
  return wheelManifest;
}

/**
 * Detect non-stdlib imports in user code via Pyodide's find_imports,
 * then normalize to pip package names.
 */
async function findImportedPackages(pyodide: PyodideInterface, code: string): Promise<string[]> {
  const raw = await pyodide.runPythonAsync(`
from pyodide.code import find_imports
import sys as _sys
_stdlib = set(getattr(_sys, 'stdlib_module_names', set())) | set(_sys.builtin_module_names)
[m for m in find_imports(${JSON.stringify(code)}) if m.split('.')[0].lower() not in _stdlib]
`);

  const imports: string[] = raw?.toJs?.() ?? [];
  raw?.destroy?.();
  const unique = new Set(imports.map(normalizePackageName).filter(Boolean));
  return [...unique];
}

export interface CodeExecutionRequest {
  code: string;
  packages?: string[];
  files?: ArtifactFiles;
}

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  files?: ArtifactFiles;
}

let pyodideInstance: PyodideInterface | null = null;
let pyodideLoading: Promise<PyodideInterface> | null = null;
const loadedPackages = new Set<string>();
let kaleidoMockApplied = false;
let plotlyShimApplied = false;

function syncFilesToPyodide(pyodide: PyodideInterface, files: ArtifactFiles): void {
  // Clear existing files
  clearDirectory(pyodide, SANDBOX_HOME);
  ensureDir(pyodide, SANDBOX_HOME);

  for (const [path, file] of Object.entries(files)) {
    const fsPath = `${SANDBOX_HOME}/${path.startsWith("/") ? path.slice(1) : path}`;
    const dir = fsPath.substring(0, fsPath.lastIndexOf("/"));
    if (dir) ensureDir(pyodide, dir);

    if (isDataUrl(file.content) || (file.contentType && !isTextContentType(file.contentType))) {
      const parsed = dataUrlToBytes(file.content);
      pyodide.FS.writeFile(fsPath, parsed ? parsed.bytes : new TextEncoder().encode(file.content));
    } else {
      pyodide.FS.writeFile(fsPath, file.content);
    }
  }
}

function collectPyodideFiles(pyodide: PyodideInterface, sourceFiles: ArtifactFiles): ArtifactFiles {
  const files: ArtifactFiles = {};

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = (pyodide.FS.readdir(dir) as string[]).filter((e) => e !== "." && e !== "..");
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = `${dir}/${entry}`;
      try {
        const stat = pyodide.FS.stat(fullPath);
        if (pyodide.FS.isDir(stat.mode)) {
          walk(fullPath);
          continue;
        }

        const artifactPath = `/${fullPath.slice(SANDBOX_HOME.length + 1)}`;
        if (artifactPath === "/") continue;

        const contentType = sourceFiles[artifactPath]?.contentType ?? inferContentTypeFromPath(artifactPath);

        if (isTextContentType(contentType)) {
          files[artifactPath] = {
            content: pyodide.FS.readFile(fullPath, { encoding: "utf8" }) as string,
            contentType,
          };
        } else {
          const bytes = pyodide.FS.readFile(fullPath) as Uint8Array;
          const ct = contentType ?? "application/octet-stream";
          files[artifactPath] = { content: bytesToDataUrl(bytes, ct), contentType: ct };
        }
      } catch {
        // Skip unreadable files.
      }
    }
  };

  walk(SANDBOX_HOME);
  return files;
}

async function ensurePackagesLoaded(pyodide: PyodideInterface, packages: string[]): Promise<void> {
  const toLoad = packages.filter((pkg) => !loadedPackages.has(pkg) && !IGNORED_PACKAGES.has(pkg));
  if (toLoad.length === 0) return;

  const manifest = await getWheelManifest();
  const pyodideBuiltins: string[] = [];
  const pypiPackages: string[] = [];

  for (const pkg of toLoad) {
    (manifest[pkg] ? pypiPackages : pyodideBuiltins).push(pkg);
  }

  if (pyodideBuiltins.length > 0) {
    await pyodide.loadPackage(pyodideBuiltins);
    for (const pkg of pyodideBuiltins) loadedPackages.add(pkg);
  }

  if (pypiPackages.length > 0) {
    await pyodide.loadPackage("micropip");

    // Register mock kaleido so micropip considers it "installed" and won't
    // try to install the native binary. Plotly's built-in renderer works without it.
    if (pypiPackages.includes("plotly") && !kaleidoMockApplied) {
      await pyodide.runPythonAsync('import micropip; micropip.add_mock_package("kaleido", "1.1.0")');
      kaleidoMockApplied = true;
    }

    for (const pkg of pypiPackages) {
      await pyodide.runPythonAsync(`import micropip; await micropip.install("/pyodide/${manifest[pkg]}")`);
      loadedPackages.add(pkg);
    }
  }
}

async function runPythonCode(pyodide: PyodideInterface, code: string): Promise<string> {
  let output = "";
  const collect = (text: string) => {
    output += `${text}\n`;
  };

  pyodide.setStdout({ batched: collect });
  pyodide.setStderr({ batched: collect });

  const result = await pyodide.runPythonAsync(code);

  if (result !== undefined && result !== null && !output.trim()) {
    return String(result);
  }

  return output.trim() || NO_OUTPUT_MESSAGE;
}

function registerLlmGlobal(pyodide: PyodideInterface): void {
  pyodide.globals.set("llm", async (prompt: string) => runLlm(prompt));
}

async function loadPyodide(): Promise<PyodideInterface> {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoading) return pyodideLoading;

  pyodideLoading = (async () => {
    try {
      pyodideInstance = await loadPyodideRuntime({ indexURL: "/pyodide/" });
      registerLlmGlobal(pyodideInstance);
      console.log("Pyodide loaded successfully");
      return pyodideInstance;
    } catch (error) {
      console.error("Failed to load Pyodide:", error);
      pyodideLoading = null;
      throw error;
    }
  })();

  return pyodideLoading;
}

export async function executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
  const { code, packages = [], files = {} } = request;

  try {
    const pyodide = await loadPyodide();
    const importedPackages = await findImportedPackages(pyodide, code);
    const requestedPackages = [
      ...new Set([...importedPackages, ...packages.map(normalizePackageName).filter(Boolean)]),
    ];

    syncFilesToPyodide(pyodide, files);
    await ensurePackagesLoaded(pyodide, requestedPackages);

    // Apply plotly shim after packages are loaded (once per session)
    if (requestedPackages.includes("plotly") && !plotlyShimApplied) {
      await pyodide.runPythonAsync(PLOTLY_IMAGE_SHIM);
      plotlyShimApplied = true;
    }

    clearRenderQueue(pyodide);
    const output = await runPythonCode(pyodide, code);
    await processRenderQueue(pyodide);

    return {
      success: true,
      output,
      files: collectPyodideFiles(pyodide, files),
    };
  } catch (error) {
    console.error("Code execution error:", error);
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// FS helpers

function ensureDir(pyodide: PyodideInterface, dir: string): void {
  try {
    pyodide.FS.mkdirTree(dir);
  } catch {
    // Already exists.
  }
}

function clearDirectory(pyodide: PyodideInterface, dir: string): void {
  let entries: string[];
  try {
    entries = (pyodide.FS.readdir(dir) as string[]).filter((e) => e !== "." && e !== "..");
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = `${dir}/${entry}`;
    const stat = pyodide.FS.stat(fullPath);

    if (pyodide.FS.isDir(stat.mode)) {
      clearDirectory(pyodide, fullPath);
      pyodide.FS.rmdir(fullPath);
    } else {
      pyodide.FS.unlink(fullPath);
    }
  }
}
