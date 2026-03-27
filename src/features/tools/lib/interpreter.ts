import { loadPyodide as loadPyodideRuntime, type PyodideInterface } from "pyodide";
import { bytesToDataUrl, dataUrlToBytes, isDataUrlContent } from "@/shared/lib/artifactFiles";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";

interface ArtifactFile {
  content: string;
  contentType?: string;
}

type ArtifactFiles = Record<string, ArtifactFile>;

interface PyodideProxy<T = unknown> {
  toJs?: () => T;
  destroy?: () => void;
}

interface MicropipModule {
  install: (pkg: string) => Promise<void>;
  destroy?: () => void;
}

const PACKAGE_ALIASES: Record<string, string> = {
  "matplotlib.pyplot": "matplotlib",
  "matplotlib.ticker": "matplotlib",
  docx: "python-docx",
  pptx: "python-pptx",
  pil: "pillow",
  bs4: "beautifulsoup4",
  sklearn: "scikit-learn",
  dateutil: "python-dateutil",
  typing_extensions: "typing-extensions",
};

let standardLibraryModules: Set<string> | null = null;
const PYODIDE_BASE_DIR = "/home/pyodide";
const NO_OUTPUT_MESSAGE = "Code executed successfully (no output)";

function normalizePackageName(name: string): string {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (!lower) {
    return lower;
  }

  if (PACKAGE_ALIASES[lower]) {
    return PACKAGE_ALIASES[lower];
  }

  const rootModule = lower.split(".")[0];
  return PACKAGE_ALIASES[rootModule] ?? rootModule;
}

function uniquePackages(packages: string[]): string[] {
  return Array.from(new Set(packages.map(normalizePackageName).filter(Boolean)));
}

// Manifest mapping package names to local wheel filenames (built at compile time)
let wheelManifest: Record<string, string> | null = null;
async function getWheelManifest(): Promise<Record<string, string>> {
  if (wheelManifest) {
    return wheelManifest;
  }

  try {
    const res = await fetch("/pyodide/pypi-manifest.json");
    if (!res.ok) {
      throw new Error(`Failed to load bundled package manifest: ${res.status}`);
    }

    wheelManifest = (await res.json()) as Record<string, string>;
    return wheelManifest;
  } catch (error) {
    throw new Error(`Bundled Python package manifest is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getStandardLibraryModules(pyodide: PyodideInterface): Promise<Set<string>> {
  if (standardLibraryModules) {
    return standardLibraryModules;
  }

  const modules = pyodide.runPython("import sys\nsorted(set(sys.stdlib_module_names) | set(sys.builtin_module_names))") as PyodideProxy<unknown>;

  try {
    const values = modules.toJs ? modules.toJs() : modules;
    standardLibraryModules = new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase()) : []);
    return standardLibraryModules;
  } finally {
    modules.destroy?.();
  }
}

function isStandardLibraryModule(name: string, stdlibModules: Set<string>): boolean {
  const rootModule = name.trim().toLowerCase().split(".")[0];
  return stdlibModules.has(rootModule);
}

async function findImportedPackages(pyodide: PyodideInterface, code: string): Promise<string[]> {
  const globals = pyodide.toPy({ source_code: code });

  try {
    const imports = pyodide.runPython(`from pyodide.code import find_imports\nfind_imports(source_code)`, { globals }) as PyodideProxy<unknown>;

    try {
      const values = imports.toJs ? imports.toJs() : imports;
      if (Array.isArray(values)) {
        const stdlibModules = await getStandardLibraryModules(pyodide);
        return uniquePackages(values.filter((value): value is string => typeof value === "string").filter((value) => !isStandardLibraryModule(value, stdlibModules)));
      }

      return [];
    } finally {
      imports.destroy?.();
    }
  } finally {
    globals.destroy();
  }
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

function ensureDirectory(pyodide: PyodideInterface, dir: string): void {
  try {
    pyodide.FS.mkdirTree(dir);
  } catch {
    // Directory may already exist.
  }
}

function toFsPath(path: string): string {
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  return `${PYODIDE_BASE_DIR}/${relativePath}`;
}

function isBinaryFile(file: ArtifactFile): boolean {
  return isDataUrlContent(file.content) || (!!file.contentType && !isTextContentType(file.contentType));
}

function toBinaryBytes(file: ArtifactFile): Uint8Array {
  const parsed = dataUrlToBytes(file.content);
  if (parsed) {
    return parsed.bytes;
  }

  return new TextEncoder().encode(file.content);
}

function clearPyodideDirectory(pyodide: PyodideInterface, dir: string): void {
  try {
    const entries = pyodide.FS.readdir(dir).filter((entry: string) => entry !== "." && entry !== "..");

    for (const entry of entries) {
      const fullPath = dir === "/" ? `/${entry}` : `${dir}/${entry}`;
      const stat = pyodide.FS.stat(fullPath);

      if (pyodide.FS.isDir(stat.mode)) {
        clearPyodideDirectory(pyodide, fullPath);
        pyodide.FS.rmdir(fullPath);
      } else {
        pyodide.FS.unlink(fullPath);
      }
    }
  } catch {
    // Ignore directories that do not exist yet.
  }
}

function syncFilesToPyodide(pyodide: PyodideInterface, files: ArtifactFiles): void {
  clearPyodideDirectory(pyodide, PYODIDE_BASE_DIR);

  ensureDirectory(pyodide, PYODIDE_BASE_DIR);

  for (const [path, file] of Object.entries(files)) {
    const fsPath = toFsPath(path);
    const dir = fsPath.substring(0, fsPath.lastIndexOf("/"));

    if (dir) {
      ensureDirectory(pyodide, dir);
    }

    if (isBinaryFile(file)) {
      pyodide.FS.writeFile(fsPath, toBinaryBytes(file));
    } else {
      pyodide.FS.writeFile(fsPath, file.content);
    }
  }
}

function collectPyodideFiles(pyodide: PyodideInterface, sourceFiles: ArtifactFiles): ArtifactFiles {
  const files: ArtifactFiles = {};

  const walkDir = (dir: string) => {
    try {
      const entries = pyodide.FS.readdir(dir).filter((entry: string) => entry !== "." && entry !== "..");

      for (const entry of entries) {
        const fullPath = dir === "/" ? `/${entry}` : `${dir}/${entry}`;

        try {
          const stat = pyodide.FS.stat(fullPath);
          if (pyodide.FS.isDir(stat.mode)) {
            walkDir(fullPath);
            continue;
          }

          const relativePath = fullPath.slice(PYODIDE_BASE_DIR.length + 1);
          if (!relativePath) {
            continue;
          }

          const priorContentType = sourceFiles[`/${relativePath}`]?.contentType ?? sourceFiles[relativePath]?.contentType;
          const contentType = priorContentType ?? inferContentTypeFromPath(relativePath);

          if (isTextContentType(contentType)) {
            files[relativePath] = {
              content: pyodide.FS.readFile(fullPath, { encoding: "utf8" }) as string,
              contentType,
            };
            continue;
          }

          const bytes = pyodide.FS.readFile(fullPath) as Uint8Array;
          files[relativePath] = {
            content: bytesToDataUrl(bytes, contentType ?? "application/octet-stream"),
            contentType: contentType ?? "application/octet-stream",
          };
        } catch {
          // Skip files that can't be read.
        }
      }
    } catch {
      // Skip directories that can't be listed.
    }
  };

  walkDir(PYODIDE_BASE_DIR);
  return files;
}

async function ensurePackagesLoaded(pyodide: PyodideInterface, packages: string[]): Promise<void> {
  const toLoad = packages.filter((pkg) => !loadedPackages.has(pkg));
  if (toLoad.length === 0) {
    return;
  }

  const manifest = await getWheelManifest();
  const pyodideBuiltins: string[] = [];
  const pypiPackages: string[] = [];

  for (const pkg of toLoad) {
    if (manifest[pkg]) {
      pypiPackages.push(pkg);
    } else {
      pyodideBuiltins.push(pkg);
    }
  }

  if (pyodideBuiltins.length > 0) {
    await pyodide.loadPackage(pyodideBuiltins);
    for (const pkg of pyodideBuiltins) {
      loadedPackages.add(pkg);
    }
  }

  if (pypiPackages.length > 0) {
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip") as MicropipModule;

    try {
      for (const pkg of pypiPackages) {
        await micropip.install(`/pyodide/${manifest[pkg]}`);
        loadedPackages.add(pkg);
      }
    } finally {
      micropip.destroy?.();
    }
  }
}

async function runPythonCode(pyodide: PyodideInterface, code: string): Promise<string> {
  let output = "";

  pyodide.setStdout({
    batched: (text: string) => {
      output += `${text}\n`;
    },
  });

  pyodide.setStderr({
    batched: (text: string) => {
      output += `${text}\n`;
    },
  });

  const result = await pyodide.runPythonAsync(code);

  if (result !== undefined && result !== null && !output.trim()) {
    return String(result);
  }

  return output.trim() || NO_OUTPUT_MESSAGE;
}

async function loadPyodide(): Promise<PyodideInterface> {
  if (pyodideInstance) {
    return pyodideInstance;
  }

  if (pyodideLoading) {
    return pyodideLoading;
  }

  pyodideLoading = (async () => {
    try {
      pyodideInstance = await loadPyodideRuntime({
        indexURL: "/pyodide/",
      });

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
    const requestedPackages = uniquePackages([...importedPackages, ...packages]);

    syncFilesToPyodide(pyodide, files);
    await ensurePackagesLoaded(pyodide, requestedPackages);

    return {
      success: true,
      output: await runPythonCode(pyodide, code),
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
