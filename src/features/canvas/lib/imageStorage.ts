import type { Image, ImageVersion } from "../types/canvas";
import { DEFAULTS, normalizeRecipe } from "./recipe";
import * as opfs from "@/shared/lib/opfs";
import { withPersistenceLock } from "@/shared/lib/persistence";

const COLLECTION = "images";

/**
 * Stored shape. Images written before versions and recipes existed lack those
 * fields and are read as one "generated" version with default adjustments.
 */
interface StoredImageMeta {
  id: string;
  title?: string;
  created: string | null;
  updated: string | null;
  model: string;
  prompt: string;
  width?: number;
  height?: number;
  /** MIME type of image.png's bytes; opened photos keep their own encoding. */
  contentType?: string;
  versions?: ImageVersion[];
  recipe?: unknown;
}

// OPFS layout
// /images/{id}/metadata.json           metadata, recipe, version list
// /images/{id}/image.png               current version's pixels
// /images/{id}/versions/{versionId}.png superseded versions

const LEGACY_VERSION_ID = "v1";

export function legacyVersion(meta: Pick<StoredImageMeta, "created" | "model" | "prompt">): ImageVersion {
  return {
    id: LEGACY_VERSION_ID,
    kind: "generated",
    prompt: meta.prompt,
    model: meta.model,
    created: meta.created ?? new Date(0).toISOString(),
  };
}

/** Build the in-memory image from stored metadata plus the current pixels. */
export function hydrateImage(id: string, meta: StoredImageMeta, data: string): Image {
  const versions = meta.versions?.length ? meta.versions : [legacyVersion(meta)];
  return {
    id,
    title: meta.title,
    created: meta.created ? new Date(meta.created) : null,
    updated: meta.updated ? new Date(meta.updated) : null,
    model: meta.model,
    prompt: meta.prompt,
    data,
    width: meta.width,
    height: meta.height,
    versions,
    recipe: meta.recipe === undefined ? DEFAULTS : normalizeRecipe(meta.recipe),
  };
}

export function currentVersionId(image: Pick<Image, "versions">): string {
  return image.versions.at(-1)?.id ?? LEGACY_VERSION_ID;
}

export async function storeImage(image: Image): Promise<void> {
  return withPersistenceLock("collection:images", () => writeImage(image));
}

async function writeImage(image: Image): Promise<void> {
  try {
    const imagePath = `${COLLECTION}/${image.id}`;
    const existing = await opfs.readJson<StoredImageMeta>(`${imagePath}/metadata.json`);
    const previousId = existing ? currentVersionId({ versions: existing.versions ?? [legacyVersion(existing)] }) : null;
    const nextId = currentVersionId(image);

    // Pixels are written only when the current version changed; a slider move
    // is a small metadata write. The superseded pixels move to versions/ so
    // the history can be revisited.
    let contentType = existing?.contentType;
    if (previousId !== nextId) {
      if (existing && previousId && image.versions.some((version) => version.id === previousId)) {
        const previous = await opfs.readBlob(`${imagePath}/image.png`);
        if (previous) await opfs.writeBlob(`${imagePath}/versions/${previousId}.png`, previous);
      }
      const blob = opfs.isDataUrl(image.data)
        ? opfs.dataUrlToBlob(image.data)
        : new Blob([image.data], { type: "image/png" });
      await opfs.writeBlob(`${imagePath}/image.png`, blob);
      contentType = blob.type || "image/png";
    }

    const meta: StoredImageMeta = {
      id: image.id,
      title: image.title,
      created: image.created?.toISOString() ?? null,
      updated: image.updated?.toISOString() ?? null,
      model: image.model,
      prompt: image.prompt,
      width: image.width,
      height: image.height,
      contentType,
      versions: image.versions,
      recipe: image.recipe,
    };
    await opfs.writeJson(`${imagePath}/metadata.json`, meta);

    // Drop pixels of versions that were deleted from the history.
    if (existing?.versions) {
      const kept = new Set(image.versions.map((version) => version.id));
      for (const version of existing.versions) {
        if (version.id === nextId || kept.has(version.id)) continue;
        await opfs.deleteFile(`${imagePath}/versions/${version.id}.png`).catch(() => {});
      }
    }
    // Clean up legacy file if present
    try {
      await opfs.deleteFile(`${imagePath}/image.bin`);
    } catch {
      /* ignore */
    }

    await opfs.upsertIndexEntry(COLLECTION, {
      id: image.id,
      title: image.title,
      updated: meta.updated || meta.created || new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error saving image to OPFS:", error);
    throw error;
  }
}

export async function loadImage(id: string): Promise<Image | undefined> {
  try {
    const imagePath = `${COLLECTION}/${id}`;
    const meta = await opfs.readJson<StoredImageMeta>(`${imagePath}/metadata.json`);
    if (!meta) return undefined;

    // Legacy files used .bin instead of .png. Stamp image/png so a legacy
    // read-back type (application/macbinary on Safari) can't leak into the data URL.
    const blob = (await opfs.readBlob(`${imagePath}/image.png`)) ?? (await opfs.readBlob(`${imagePath}/image.bin`));
    const data = blob ? await opfs.blobToDataUrl(blob, meta.contentType || "image/png") : "";
    return hydrateImage(id, meta, data);
  } catch (error) {
    console.error(`Error loading image ${id} from OPFS:`, error);
    return undefined;
  }
}

/** Pixels of one version: the current one from image.png, older ones from versions/. */
export async function loadVersionBlob(image: Image, versionId: string): Promise<Blob | undefined> {
  const imagePath = `${COLLECTION}/${image.id}`;
  if (versionId === currentVersionId(image)) {
    return opfs.isDataUrl(image.data) ? opfs.dataUrlToBlob(image.data) : opfs.readBlob(`${imagePath}/image.png`);
  }
  return opfs.readBlob(`${imagePath}/versions/${versionId}.png`);
}

export async function removeImage(id: string): Promise<void> {
  return withPersistenceLock("collection:images", () => deleteImageFiles(id));
}

async function deleteImageFiles(id: string): Promise<void> {
  try {
    await opfs.deleteDirectory(`${COLLECTION}/${id}`);
    await opfs.removeIndexEntry(COLLECTION, id);
  } catch (error) {
    console.error(`Error deleting image ${id} from OPFS:`, error);
    throw error;
  }
}

export async function loadImages(): Promise<Image[]> {
  return withPersistenceLock("collection:images", async () => {
    const images: Image[] = [];
    for (const entry of await opfs.readIndex(COLLECTION)) {
      const image = await loadImage(entry.id);
      if (image) images.push(image);
    }
    return images.sort((a, b) => (b.created?.getTime() || 0) - (a.created?.getTime() || 0));
  });
}
