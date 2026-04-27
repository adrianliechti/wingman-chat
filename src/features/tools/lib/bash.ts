import type { InitialFiles } from "just-bash/browser";
import { Bash, InMemoryFs } from "just-bash/browser";
import type { OverlayFile } from "@/features/artifacts/lib/fs";
import { bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/fileContent";
import { SANDBOX_HOME } from "@/shared/lib/sandbox";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { getLlmModel, llmCommands } from "./llmCommand";
import { pythonCommands } from "./pythonCommand";

export interface BashExecutionRequest {
  command: string;
}

export interface BashExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BashInstance {
  bash: Bash;
  memFs: InMemoryFs;
}

function toFsContent(file: { content: string; contentType?: string }): string | Uint8Array {
  const parsed = dataUrlToBytes(file.content);
  if (parsed) {
    return parsed.bytes;
  }

  return file.content;
}

function toOverlayFile(path: string, content: Uint8Array): OverlayFile {
  const contentType = inferContentTypeFromPath(path);
  if (isTextContentType(contentType)) {
    return {
      content: new TextDecoder().decode(content),
      contentType,
    };
  }

  const mimeType = contentType ?? "application/octet-stream";
  return {
    content: bytesToDataUrl(content, mimeType),
    contentType: mimeType,
  };
}

let singleton: BashInstance | null = null;

/**
 * Create a new Bash + InMemoryFs pair, optionally preloaded with files.
 * Files keys are artifact paths (e.g. "/script.sh"), mapped to /home/user/...
 */
export function createBashInstance(files?: Record<string, { content: string; contentType?: string }>): BashInstance {
  const initialFiles: InitialFiles = {};

  if (files) {
    for (const [path, file] of Object.entries(files)) {
      const relativePath = path.startsWith("/") ? path.slice(1) : path;
      initialFiles[`${SANDBOX_HOME}/${relativePath}`] = toFsContent(file);
    }
  }

  const memFs = new InMemoryFs(initialFiles);
  const bash = new Bash({
    fs: memFs,
    cwd: SANDBOX_HOME,
    customCommands: [...pythonCommands, ...(getLlmModel() ? llmCommands : [])],
    executionLimits: {
      maxCallDepth: 50,
      maxCommandCount: 10000,
      maxLoopIterations: 10000,
    },
  });

  return { bash, memFs };
}

export function getBashCwd(instance: BashInstance): string {
  const bashWithCwd = instance.bash as Bash & { getCwd?: () => string };
  return bashWithCwd.getCwd?.() ?? SANDBOX_HOME;
}

export function getBashEnv(instance: BashInstance): Record<string, string> {
  const bashWithEnv = instance.bash as Bash & { getEnv?: () => Record<string, string> };
  return (
    bashWithEnv.getEnv?.() ?? { HOME: SANDBOX_HOME, PWD: SANDBOX_HOME, OLDPWD: SANDBOX_HOME, PATH: "/usr/bin:/bin" }
  );
}

export async function resolveBashCwd(memFs: InMemoryFs, cwd?: string | null): Promise<string> {
  const candidate = cwd?.trim();
  if (!candidate) {
    return SANDBOX_HOME;
  }

  try {
    const stat = await memFs.stat(candidate);
    return stat.isDirectory ? candidate : SANDBOX_HOME;
  } catch {
    return SANDBOX_HOME;
  }
}

/**
 * Execute a bash command using the singleton instance.
 * The singleton persists filesystem state across calls within one session.
 */
export async function executeBash(request: BashExecutionRequest): Promise<BashExecutionResult> {
  const { command } = request;

  try {
    if (!singleton) {
      singleton = createBashInstance();
    }

    const result = await singleton.bash.exec(command);

    return {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error) {
    console.error("Bash execution error:", error);

    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
}

/** Get the singleton BashInstance (creating it if needed). */
export function getSingleton(): BashInstance {
  if (!singleton) {
    singleton = createBashInstance();
  }
  return singleton;
}

/** Reset the singleton bash instance. */
export function resetBash(): void {
  singleton = null;
}

/**
 * Load artifact files into an InMemoryFs under /home/user/.
 * Existing files at those paths are overwritten and stale files are removed.
 */
export async function loadArtifactsIntoFs(
  memFs: InMemoryFs,
  files: { path: string; content: string; contentType?: string }[],
): Promise<void> {
  const desiredPaths = new Set(
    files.map((file) => {
      const relativePath = file.path.startsWith("/") ? file.path.slice(1) : file.path;
      return `${SANDBOX_HOME}/${relativePath}`;
    }),
  );

  for (const fsPath of memFs.getAllPaths()) {
    if (!fsPath.startsWith(`${SANDBOX_HOME}/`) || desiredPaths.has(fsPath)) {
      continue;
    }

    try {
      const stat = await memFs.lstat(fsPath);
      if (stat.isDirectory) {
        continue;
      }

      await memFs.rm(fsPath, { force: true });
    } catch {
      // Skip paths that disappeared mid-sync.
    }
  }

  for (const file of files) {
    const relativePath = file.path.startsWith("/") ? file.path.slice(1) : file.path;
    const fsPath = `${SANDBOX_HOME}/${relativePath}`;

    // Ensure parent directories exist
    const dir = fsPath.substring(0, fsPath.lastIndexOf("/"));
    if (dir) {
      await memFs.mkdir(dir, { recursive: true });
    }

    await memFs.writeFile(fsPath, toFsContent(file));
  }
}

/**
 * Read all user files from an InMemoryFs under /home/user/.
 * Returns a map of artifact path (e.g. "/script.sh") → content.
 * Uses InMemoryFs.getAllPaths() (synchronous) instead of bash `find`.
 */
export async function readFilesFromFs(memFs: InMemoryFs): Promise<Record<string, OverlayFile>> {
  const result: Record<string, OverlayFile> = {};
  const allPaths = memFs.getAllPaths();

  for (const fsPath of allPaths) {
    if (!fsPath.startsWith(`${SANDBOX_HOME}/`)) continue;

    try {
      const stat = await memFs.stat(fsPath);
      if (!stat.isFile) continue;

      const artifactPath = `/${fsPath.slice(`${SANDBOX_HOME}/`.length)}`;
      const content = await memFs.readFileBuffer(fsPath);
      result[artifactPath] = toOverlayFile(artifactPath, content);
    } catch {
      // Skip unreadable entries
    }
  }

  return result;
}
