import type { ArtifactFile, ArtifactFiles, CodeExecutionLimits } from "./interpreterProtocol";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";

const encoder = new TextEncoder();

/** Conservative browser-runtime defaults. Callers may lower them per run. */
export const DEFAULT_CODE_EXECUTION_LIMITS: Required<CodeExecutionLimits> = {
  maxOutputBytes: 512 * 1024,
  maxFiles: 4096,
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalFileBytes: 512 * 1024 * 1024,
};

export class CodeExecutionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeExecutionLimitError";
  }
}

export function resolveCodeExecutionLimits(limits?: CodeExecutionLimits): Required<CodeExecutionLimits> {
  const resolved = { ...DEFAULT_CODE_EXECUTION_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new CodeExecutionLimitError(`${name} must be a positive safe integer`);
    }
  }
  return resolved;
}

/** Size on the wire. Data URLs intentionally count their base64 expansion. */
export function artifactFileBytes(file: ArtifactFile): number {
  return encoder.encode(file.content).byteLength;
}

export function validateArtifactFiles(
  files: ArtifactFiles,
  limits: Required<CodeExecutionLimits>,
  label = "Interpreter filesystem",
): void {
  const entries = Object.entries(files);
  if (entries.length > limits.maxFiles) {
    throw new CodeExecutionLimitError(`${label} has ${entries.length} files; limit is ${limits.maxFiles}`);
  }

  let totalBytes = 0;
  const normalizedPaths = new Set<string>();
  for (const [path, file] of entries) {
    const normalized = normalizeArtifactPath(path);
    if (!normalized || normalized === "/") {
      throw new CodeExecutionLimitError(`${label} contains an invalid path: ${path}`);
    }
    if (normalizedPaths.has(normalized)) {
      throw new CodeExecutionLimitError(`${label} contains duplicate path aliases for ${normalized}`);
    }
    normalizedPaths.add(normalized);

    const bytes = artifactFileBytes(file);
    if (bytes > limits.maxFileBytes) {
      throw new CodeExecutionLimitError(`${path} is ${bytes} bytes; per-file limit is ${limits.maxFileBytes}`);
    }
    totalBytes += bytes;
    if (totalBytes > limits.maxTotalFileBytes) {
      throw new CodeExecutionLimitError(
        `${label} is over the ${limits.maxTotalFileBytes}-byte total limit (at ${path})`,
      );
    }
  }
}

function utf8Prefix(value: string, maxBytes: number): { text: string; bytes: number } {
  if (maxBytes <= 0) return { text: "", bytes: 0 };
  let text = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > maxBytes) break;
    text += character;
    bytes += characterBytes;
  }
  return { text, bytes };
}

/** Bounded stdout/stderr accumulator that never grows past the configured cap. */
export class BoundedOutput {
  private readonly chunks: string[] = [];
  private readonly maxBytes: number;
  private keptBytes = 0;
  private omittedBytes = 0;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  append(value: string): void {
    const bytes = encoder.encode(value).byteLength;
    const remaining = this.maxBytes - this.keptBytes;
    if (remaining <= 0) {
      this.omittedBytes += bytes;
      return;
    }
    if (bytes <= remaining) {
      this.chunks.push(value);
      this.keptBytes += bytes;
      return;
    }
    const prefix = utf8Prefix(value, remaining);
    if (prefix.text) this.chunks.push(prefix.text);
    this.keptBytes += prefix.bytes;
    this.omittedBytes += bytes - prefix.bytes;
  }

  value(): string {
    const body = this.chunks.join("");
    if (this.omittedBytes === 0) return body;
    const marker = `[... interpreter output truncated at ${this.maxBytes} bytes ...]`;
    const markerBytes = encoder.encode(marker).byteLength;
    if (markerBytes >= this.maxBytes) return utf8Prefix(marker, this.maxBytes).text;

    const trimmed = body.replace(/\s+$/, "");
    const prefix = utf8Prefix(trimmed, this.maxBytes - markerBytes - 1).text.replace(/\s+$/, "");
    return prefix ? `${prefix}\n${marker}` : marker;
  }
}
