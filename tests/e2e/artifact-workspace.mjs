import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".txt", "text/plain"],
]);

function contentTypeFor(filePath, fallback) {
  return fallback ?? CONTENT_TYPES.get(path.posix.extname(filePath).toLowerCase()) ?? "text/plain";
}

function virtualPath(value) {
  assert.equal(typeof value, "string", "Artifact paths must be strings");
  let candidate = value.trim().replace(/^\/home\/(?:user|pyodide)\//, "/");
  if (!candidate.startsWith("/")) candidate = `/${candidate}`;
  const segments = candidate.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) throw new Error(`Artifact path escapes workspace: ${value}`);
  if (segments.some((segment) => segment.includes("\0"))) throw new Error("Artifact path contains a null byte");
  return `/${segments.join("/")}`;
}

/**
 * Disk-backed implementation of the production file-tool source contract.
 * It gives real file I/O to model-driven tests while preserving Wingman's
 * virtual paths and artifact deltas.
 */
export async function createArtifactWorkspace(artifactModule, initial = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wingman-artifacts-e2e-"));
  const contentTypes = new Map();
  const mutations = [];

  const localPath = (filePath) => {
    const normalized = virtualPath(filePath);
    assert.notEqual(normalized, "/", "The artifact workspace root is not a file");
    return { normalized, absolute: path.join(root, ...normalized.slice(1).split("/")) };
  };

  const read = async (filePath) => {
    const { normalized, absolute } = localPath(filePath);
    try {
      const content = await fs.readFile(absolute, "utf8");
      const contentType = contentTypeFor(normalized, contentTypes.get(normalized));
      return {
        path: normalized,
        content,
        contentType,
        revision: await artifactModule.artifactRevision(content, contentType),
      };
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EISDIR") return undefined;
      throw error;
    }
  };

  const writeRaw = async (filePath, content, contentType) => {
    const { normalized, absolute } = localPath(filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
    contentTypes.set(normalized, contentTypeFor(normalized, contentType));
    return normalized;
  };

  const list = async () => {
    const entries = [];
    const walk = async (directory) => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) {
          const relative = path.relative(root, absolute).split(path.sep).join("/");
          const file = await read(`/${relative}`);
          if (file) {
            entries.push({
              path: file.path,
              size: new TextEncoder().encode(file.content).byteLength,
              contentType: file.contentType,
              revision: file.revision,
            });
          }
        }
      }
    };
    await walk(root);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  };

  const write = async (filePath, content, contentType) => {
    const normalized = virtualPath(filePath);
    const existing = await read(normalized);
    const resolvedContentType = contentTypeFor(normalized, contentType ?? existing?.contentType);
    if (existing?.content === content && existing.contentType === resolvedContentType) return [];

    await writeRaw(normalized, content, resolvedContentType);
    const checksum = await artifactModule.artifactChecksum(content, resolvedContentType);
    const mutation = {
      operation: existing ? "update" : "create",
      path: normalized,
      contentType: resolvedContentType,
      size: new TextEncoder().encode(content).byteLength,
      checksum,
      revision: `sha256:${checksum}`,
    };
    mutations.push(mutation);
    return [mutation];
  };

  const remove = async (filePath) => {
    const normalized = virtualPath(filePath);
    const direct = await read(normalized);
    const targets = direct
      ? [normalized]
      : (await list()).map((entry) => entry.path).filter((candidate) => candidate.startsWith(`${normalized}/`));
    if (targets.length === 0) return [];
    const deleted = [];
    for (const target of targets) {
      const file = await read(target);
      if (!file) continue;
      await fs.rm(localPath(target).absolute);
      contentTypes.delete(target);
      deleted.push({ operation: "delete", path: target, contentType: file.contentType, revision: file.revision });
    }
    mutations.push(...deleted);
    return deleted;
  };

  const move = async (from, to) => {
    const sourcePath = virtualPath(from);
    const targetPath = virtualPath(to);
    const file = await read(sourcePath);
    if (!file || (await read(targetPath))) return [];
    const target = localPath(targetPath);
    await fs.mkdir(path.dirname(target.absolute), { recursive: true });
    await fs.rename(localPath(sourcePath).absolute, target.absolute);
    contentTypes.delete(sourcePath);
    contentTypes.set(targetPath, file.contentType);
    const mutation = {
      operation: "move",
      from: sourcePath,
      path: targetPath,
      contentType: file.contentType,
      size: new TextEncoder().encode(file.content).byteLength,
      revision: file.revision,
    };
    mutations.push(mutation);
    return [mutation];
  };

  for (const [filePath, value] of Object.entries(initial)) {
    const content = typeof value === "string" ? value : value.content;
    const contentType = typeof value === "string" ? undefined : value.contentType;
    await writeRaw(filePath, content, contentType);
  }

  const source = { list, read, write, remove, move };
  const artifactFs = {
    async listFiles() {
      return Promise.all((await list()).map((entry) => read(entry.path)));
    },
  };

  return {
    root,
    source,
    artifactFs,
    mutations,
    read,
    list,
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
