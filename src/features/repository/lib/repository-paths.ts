import type { RepositoryFile } from "@/features/repository/types/repository";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";

const MAX_FILE_NAME_LENGTH = 180;
const DEFAULT_FILE_NAME = "document";

export type ResolvedRepositoryFile = RepositoryFile & { path: string };

function comparisonKey(path: string): string {
  return path.normalize("NFKC").toLocaleLowerCase("en-US");
}

/** Convert an untrusted upload name into one portable, root-level filename. */
export function sanitizeRepositoryFileName(name: string): string {
  let value = name
    .normalize("NFC")
    .replace(/[\\/]+/g, "-")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");

  if (!value || value === "." || value === "..") value = DEFAULT_FILE_NAME;
  if (value.length <= MAX_FILE_NAME_LENGTH) return value;

  const dot = value.lastIndexOf(".");
  const extension = dot > 0 && value.length - dot <= 20 ? value.slice(dot) : "";
  const stemLimit = Math.max(1, MAX_FILE_NAME_LENGTH - extension.length);
  value = `${value.slice(0, stemLimit).trimEnd()}${extension}`;
  return value || DEFAULT_FILE_NAME;
}

function validStoredPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = normalizeArtifactPath(path);
  if (!normalized || normalized === "/" || normalized.slice(1).includes("/")) return undefined;
  if (normalized !== `/${sanitizeRepositoryFileName(normalized.slice(1))}`) return undefined;
  return normalized;
}

function splitExtension(fileName: string): { stem: string; extension: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || fileName.length - dot > 20) return { stem: fileName, extension: "" };
  return { stem: fileName.slice(0, dot), extension: fileName.slice(dot) };
}

function idToken(id: string): string {
  const compact = id
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/g, "");
  if (compact.length >= 8) return compact.slice(0, 32);

  // Legacy imports may contain short or unusual IDs. FNV-1a supplies a stable
  // readable fallback without adding an async crypto step to path allocation.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${compact}${(hash >>> 0).toString(36)}`.padEnd(8, "0");
}

function collisionPath(fileName: string, id: string, used: ReadonlySet<string>): string {
  const { stem, extension } = splitExtension(fileName);
  const token = idToken(id);
  const withSuffix = (suffix: string) =>
    `/${stem.slice(0, Math.max(1, MAX_FILE_NAME_LENGTH - extension.length - suffix.length))}${suffix}${extension}`;

  for (let length = Math.min(8, token.length); length <= token.length; length += 4) {
    const candidate = withSuffix(`~${token.slice(0, length)}`);
    if (!used.has(comparisonKey(candidate))) return candidate;
  }

  const full = withSuffix(`~${token}`);
  if (!used.has(comparisonKey(full))) return full;
  for (let counter = 2; ; counter++) {
    const candidate = withSuffix(`~${token}-${counter}`);
    if (!used.has(comparisonKey(candidate))) return candidate;
  }
}

/** Allocate a path for a new file without changing any existing allocation. */
export function allocateRepositoryFilePath(name: string, id: string, existingPaths: Iterable<string>): string {
  const used = new Set([...existingPaths].map(comparisonKey));
  const fileName = sanitizeRepositoryFileName(name);
  const preferred = `/${fileName}`;
  return used.has(comparisonKey(preferred)) ? collisionPath(fileName, id, used) : preferred;
}

function migrationOrder(a: RepositoryFile, b: RepositoryFile): number {
  const aTime = a.uploadedAt instanceof Date ? a.uploadedAt.getTime() : new Date(a.uploadedAt).getTime();
  const bTime = b.uploadedAt instanceof Date ? b.uploadedAt.getTime() : new Date(b.uploadedAt).getTime();
  const safeATime = Number.isFinite(aTime) ? aTime : 0;
  const safeBTime = Number.isFinite(bTime) ? bTime : 0;
  return safeATime - safeBTime || a.id.localeCompare(b.id);
}

export interface RepositoryPathReconciliation {
  files: ResolvedRepositoryFile[];
  /** IDs whose metadata must be written back. */
  changedIds: string[];
}

/**
 * Reconcile current and legacy metadata without renaming physical OPFS data.
 * Existing valid unique paths win; missing, unsafe, or duplicate paths are
 * assigned deterministically and never depend on input enumeration order.
 */
export function reconcileRepositoryFilePaths(files: readonly RepositoryFile[]): RepositoryPathReconciliation {
  const resolved = files.map((file) => ({ ...file })) as ResolvedRepositoryFile[];
  const ordered = [...resolved].sort(migrationOrder);
  const used = new Set<string>();
  const needsPath: ResolvedRepositoryFile[] = [];

  for (const file of ordered) {
    const path = validStoredPath(file.path);
    const key = path ? comparisonKey(path) : "";
    if (!path || used.has(key)) {
      needsPath.push(file);
      continue;
    }
    file.path = path;
    used.add(key);
  }

  for (const file of needsPath) {
    file.path = allocateRepositoryFilePath(file.name, file.id, used);
    used.add(comparisonKey(file.path));
  }

  const originalPaths = new Map(files.map((file) => [file.id, file.path]));
  return {
    files: resolved,
    changedIds: ordered.filter((file) => originalPaths.get(file.id) !== file.path).map((file) => file.id),
  };
}
