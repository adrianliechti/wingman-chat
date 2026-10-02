import { Bash, InMemoryFs, type Command, type InitialFiles } from "just-bash/browser";
import { bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { normalizeArtifactPath, SANDBOX_HOME } from "@/shared/lib/sandbox";
import {
  BoundedOutput,
  CodeExecutionLimitError,
  DEFAULT_CODE_EXECUTION_LIMITS,
  resolveCodeExecutionLimits,
  validateArtifactFiles,
} from "./executionLimits";
import {
  NO_OUTPUT_MESSAGE,
  type ArtifactFiles,
  type CodeExecutionRequest,
  type CodeExecutionResult,
} from "./interpreterProtocol";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** A fresh shell per run; only the artifact snapshot crosses execution boundaries. */
export async function runBash(
  request: CodeExecutionRequest,
  onStarted?: () => void,
  commands: Command[] = [],
): Promise<CodeExecutionResult> {
  let output: BoundedOutput | undefined;
  let maxOutputBytes = DEFAULT_CODE_EXECUTION_LIMITS.maxOutputBytes;
  try {
    const limits = resolveCodeExecutionLimits(request.limits);
    maxOutputBytes = limits.maxOutputBytes;
    output = new BoundedOutput(limits.maxOutputBytes);
    const files = request.files ?? {};
    validateArtifactFiles(files, limits, "Interpreter input filesystem");
    const originals: ArtifactFiles = {};
    const initialBytes = new Map<string, Uint8Array>();
    const initialFiles: InitialFiles = {};
    for (const [path, file] of Object.entries(files)) {
      const normalized = normalizeArtifactPath(path)!;
      const bytes = dataUrlToBytes(file.content)?.bytes ?? encoder.encode(file.content);
      originals[normalized] = file;
      initialBytes.set(normalized, bytes);
      initialFiles[`${SANDBOX_HOME}${normalized}`] = bytes;
    }

    // Reserve a small allowance for just-bash's virtual /bin, /dev and /proc.
    // The returned workspace is checked against the exact artifact limits below.
    const fs = new InMemoryFs(initialFiles, { maxTotalBytes: limits.maxTotalFileBytes + 64 * 1024 });
    await fs.mkdir(SANDBOX_HOME, { recursive: true });
    const bash = new Bash({
      fs,
      cwd: SANDBOX_HOME,
      env: { HOME: SANDBOX_HOME },
      customCommands: commands,
      executionLimits: {
        maxCallDepth: 50,
        maxCommandCount: 10_000,
        maxLoopIterations: 10_000,
        maxExecutionTimeMs: 120_000,
        maxFileSystemBytes: limits.maxTotalFileBytes,
        maxOutputSize: Math.max(limits.maxOutputBytes, DEFAULT_CODE_EXECUTION_LIMITS.maxOutputBytes),
      },
    });
    const path = request.path === undefined ? undefined : normalizeArtifactPath(request.path);
    if (request.path !== undefined && (!path || !originals[path])) {
      throw new Error(`Script file not found: ${request.path}`);
    }

    onStarted?.();
    // argv bypasses shell parsing, so spaces, quotes, globs and substitutions
    // in a supplied argument remain literal. bash sets $0/$1/... for both forms.
    const result = await bash.exec("bash", {
      args: path
        ? [`${SANDBOX_HOME}${path}`, ...(request.args ?? [])]
        : ["-c", request.code, "-c", ...(request.args ?? [])],
      rawScript: true,
    });
    output.append(result.stdout);
    output.append(result.stderr);
    if (result.exitCode !== 0) {
      const error = new BoundedOutput(limits.maxOutputBytes);
      error.append(`Script exited with status ${result.exitCode}\n`);
      error.append(output.value());
      return { success: false, output: output.value(), error: error.value() };
    }

    const snapshot: ArtifactFiles = {};
    let count = 0;
    let totalBytes = 0;
    for (const fsPath of fs.getAllPaths()) {
      if (!fsPath.startsWith(`${SANDBOX_HOME}/`)) continue;
      const stat = await fs.stat(fsPath);
      if (!stat.isFile) continue;
      const artifactPath = fsPath.slice(SANDBOX_HOME.length);
      if (++count > limits.maxFiles) {
        throw new CodeExecutionLimitError(`Interpreter filesystem has more than ${limits.maxFiles} files`);
      }
      if (stat.size > limits.maxFileBytes) {
        throw new CodeExecutionLimitError(`${artifactPath} is over the ${limits.maxFileBytes}-byte per-file limit`);
      }
      totalBytes += stat.size;
      if (totalBytes > limits.maxTotalFileBytes) {
        throw new CodeExecutionLimitError(
          `Interpreter filesystem is over the ${limits.maxTotalFileBytes}-byte total limit`,
        );
      }
      const bytes = await fs.readFileBuffer(fsPath);
      const original = originals[artifactPath];
      const before = initialBytes.get(artifactPath);
      if (original && before?.length === bytes.length && before.every((byte, index) => byte === bytes[index])) {
        snapshot[artifactPath] = original;
        continue;
      }
      let contentType =
        original?.contentType ??
        (original && dataUrlToBytes(original.content)?.mimeType) ??
        inferContentTypeFromPath(artifactPath);
      if (isTextContentType(contentType)) {
        try {
          snapshot[artifactPath] = { content: decoder.decode(bytes), contentType };
          continue;
        } catch {
          // Extensionless binary outputs must survive a trip through artifacts too.
          contentType = "application/octet-stream";
        }
      }
      contentType ??= "application/octet-stream";
      snapshot[artifactPath] = { content: bytesToDataUrl(bytes, contentType), contentType };
    }
    validateArtifactFiles(snapshot, limits);
    return { success: true, output: output.value().trim() || NO_OUTPUT_MESSAGE, files: snapshot };
  } catch (error) {
    const boundedError = new BoundedOutput(maxOutputBytes);
    boundedError.append(error instanceof Error ? error.message : String(error));
    return { success: false, output: output?.value() ?? "", error: boundedError.value() };
  }
}
