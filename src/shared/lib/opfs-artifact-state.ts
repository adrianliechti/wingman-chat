/**
 * Small JSON state an HTML artifact keeps for itself through `wingman.store`.
 * Lives beside the workspace (not in it): no file events, not part of the
 * downloadable workspace, but included in full OPFS backups.
 */

import { deleteFile, readJson, writeJson } from "./opfs-core";
import { withPersistenceLock } from "./persistence";
import { normalizeArtifactPath } from "./sandbox";

export const ARTIFACT_STATE_MAX_BYTES = 1024 * 1024;

/** Keys the app reserves for itself (consent decisions and the like). */
export const ARTIFACT_STATE_RESERVED_PREFIX = "__wingman__/";

export type ArtifactState = Record<string, unknown>;

function artifactStatePath(chatId: string, path: string): string {
  const encodedPath = encodeURIComponent(normalizeArtifactPath(path) ?? path);
  return `chats/${chatId}/artifact-state/${encodedPath}.json`;
}

export async function readArtifactState(chatId: string, path: string): Promise<ArtifactState> {
  try {
    const stored = await readJson<unknown>(artifactStatePath(chatId, path));
    return stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as ArtifactState) : {};
  } catch {
    return {};
  }
}

export async function writeArtifactState(chatId: string, path: string, state: ArtifactState): Promise<void> {
  const json = JSON.stringify(state);
  if (json === undefined) throw new TypeError("Artifact state must be JSON-serialisable.");
  const size = new TextEncoder().encode(json).byteLength;
  if (size > ARTIFACT_STATE_MAX_BYTES) {
    throw new Error(`Artifact state is ${size} bytes; the limit is ${ARTIFACT_STATE_MAX_BYTES}.`);
  }
  await writeJson(artifactStatePath(chatId, path), state);
}

export function deleteArtifactState(chatId: string, path: string): Promise<void> {
  return deleteFile(artifactStatePath(chatId, path));
}

/** Read-modify-write under a lock so concurrent calls from one page do not lose keys. */
export function updateArtifactState(
  chatId: string,
  path: string,
  update: (state: ArtifactState) => ArtifactState,
): Promise<ArtifactState> {
  return withPersistenceLock(`artifact-state:${artifactStatePath(chatId, path)}`, async () => {
    const next = update(await readArtifactState(chatId, path));
    await writeArtifactState(chatId, path, next);
    return next;
  });
}
