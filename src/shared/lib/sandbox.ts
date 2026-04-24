/**
 * Sandbox path helpers.
 *
 * All sandbox runtimes (Pyodide, Bash, ...) mount user files under a single
 * home directory. These helpers normalize paths that cross the sandbox
 * boundary so that LLM-supplied paths map to the canonical artifact paths
 * used in storage.
 */

/** Shared home directory used by all sandbox runtimes (Pyodide, Bash, etc.). */
export const SANDBOX_HOME = "/home/user";

// Sandbox mount prefixes that LLMs may include in artifact paths.
const SANDBOX_PREFIXES = [`${SANDBOX_HOME}/`, "/home/pyodide/"];

/**
 * Normalize an artifact path: strip sandbox mount prefixes, ensure a leading
 * slash, collapse duplicate slashes, strip trailing slash.
 */
export function normalizeArtifactPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  let normalized = path.trim();
  if (!normalized) {
    return undefined;
  }

  for (const prefix of SANDBOX_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length - 1); // keep leading "/"
      break;
    }
  }

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(/\/+/g, "/");

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Normalize a path used as a *reference* from within an artifact (e.g. an
 * `<img src="...">` inside a markdown artifact). Drops leading `./` and `/`.
 */
export function normalizeArtifactReferencePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}
