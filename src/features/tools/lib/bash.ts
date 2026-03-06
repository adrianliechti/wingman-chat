import { Bash, InMemoryFs } from 'just-bash/browser';
import type { InitialFiles } from 'just-bash/browser';

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

const HOME = '/home/user';

let singleton: BashInstance | null = null;

/**
 * Create a new Bash + InMemoryFs pair, optionally preloaded with files.
 * Files keys are artifact paths (e.g. "/script.sh"), mapped to /home/user/...
 */
export function createBashInstance(
  files?: Record<string, { content: string }>
): BashInstance {
  const initialFiles: InitialFiles = {};

  if (files) {
    for (const [path, file] of Object.entries(files)) {
      const relativePath = path.startsWith('/') ? path.slice(1) : path;
      initialFiles[`${HOME}/${relativePath}`] = file.content;
    }
  }

  const memFs = new InMemoryFs(initialFiles);
  const bash = new Bash({
    fs: memFs,
    cwd: HOME,
    executionLimits: {
      maxCallDepth: 50,
      maxCommandCount: 10000,
      maxLoopIterations: 10000,
    },
  });

  return { bash, memFs };
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
    console.error('Bash execution error:', error);

    return {
      success: false,
      stdout: '',
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
 * Existing files at those paths are overwritten.
 */
export async function loadArtifactsIntoFs(
  memFs: InMemoryFs,
  files: { path: string; content: string }[]
): Promise<void> {
  for (const file of files) {
    const relativePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
    const fsPath = `${HOME}/${relativePath}`;

    // Ensure parent directories exist
    const dir = fsPath.substring(0, fsPath.lastIndexOf('/'));
    if (dir) {
      await memFs.mkdir(dir, { recursive: true });
    }

    await memFs.writeFile(fsPath, file.content);
  }
}

/**
 * Read all user files from an InMemoryFs under /home/user/.
 * Returns a map of artifact path (e.g. "/script.sh") → content.
 * Uses InMemoryFs.getAllPaths() (synchronous) instead of bash `find`.
 */
export async function readFilesFromFs(
  memFs: InMemoryFs
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const allPaths = memFs.getAllPaths();

  for (const fsPath of allPaths) {
    if (!fsPath.startsWith(`${HOME}/`)) continue;

    try {
      const stat = await memFs.stat(fsPath);
      if (!stat.isFile) continue;

      const content = await memFs.readFile(fsPath);
      const artifactPath = '/' + fsPath.slice(`${HOME}/`.length);
      result[artifactPath] = content;
    } catch {
      // Skip unreadable entries
    }
  }

  return result;
}
