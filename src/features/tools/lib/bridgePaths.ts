import { getArtifactLinkPath, normalizeArtifactPath, SANDBOX_HOME } from "@/shared/lib/sandbox";

const TEMP_DIR = "/tmp";
const REDUNDANT_SEPARATORS = /\/(?:\/|\.\/)+/g;

function isInside(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`);
}

function isArtifactLink(path: string): boolean {
  return /^(artifact|sandbox):/i.test(path);
}

function checkedPath(path: string): string {
  if (typeof path !== "string" || !path.trim() || path.includes("\0")) {
    throw new Error("Expected a nonempty file path");
  }
  return path.trim();
}

/** URL fragments and query strings only have meaning on explicit artifact links. */
export function bridgeArtifactPath(path: string): string {
  const value = checkedPath(path).replace(REDUNDANT_SEPARATORS, "/");
  const normalized = isArtifactLink(value) ? getArtifactLinkPath(value) : normalizeArtifactPath(value);
  if (!normalized || normalized === "/" || value === SANDBOX_HOME || value === "/home/pyodide") {
    throw new Error(`Expected an artifact file path: ${value}`);
  }
  return normalized;
}

function resolvePath(path: string, cwd: string): string {
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Keep native paths and cwd-relative I/O working, then try the workspace path shown in chat. */
export function bridgeInputPaths(path: string, cwd: string): string[] {
  const value = checkedPath(path);
  if (isArtifactLink(value)) return [`${SANDBOX_HOME}${bridgeArtifactPath(value)}`];
  const native = resolvePath(path, cwd);
  const trimmed = resolvePath(value, cwd);
  const candidates = new Set([native, trimmed]);
  if (value.startsWith("/") && trimmed !== "/" && trimmed !== SANDBOX_HOME && !isInside(trimmed, SANDBOX_HOME)) {
    const artifact = normalizeArtifactPath(trimmed);
    if (artifact && artifact !== "/") candidates.add(`${SANDBOX_HOME}${artifact}`);
  }
  return [...candidates];
}

/** File-producing helpers default to artifacts. An explicit temp path stays temporary. */
export function bridgeOutputPath(path: string, cwd: string): string {
  const value = checkedPath(path).replace(REDUNDANT_SEPARATORS, "/");
  if (isArtifactLink(value)) return `${SANDBOX_HOME}${bridgeArtifactPath(value)}`;
  const resolved = resolvePath(value, cwd);
  const explicitRoot = [SANDBOX_HOME, TEMP_DIR].find((directory) => value === directory || isInside(value, directory));
  if (
    explicitRoot ? isInside(resolved, explicitRoot) : isInside(resolved, SANDBOX_HOME) || isInside(resolved, TEMP_DIR)
  ) {
    return resolved;
  }
  if (explicitRoot || !value.startsWith("/") || resolved === TEMP_DIR) {
    throw new Error(`Output path must name a file under ${SANDBOX_HOME} or ${TEMP_DIR}: ${value}`);
  }
  return `${SANDBOX_HOME}${bridgeArtifactPath(resolved)}`;
}
