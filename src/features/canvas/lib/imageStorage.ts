import type { Image } from "../types/canvas";
import * as opfs from "@/shared/lib/opfs";
import { withPersistenceLock } from "@/shared/lib/persistence";

const COLLECTION = "images";

interface StoredImageMeta {
  id: string;
  title?: string;
  created: string | null;
  updated: string | null;
  model: string;
  prompt: string;
}

// Image-specific OPFS operations using folder structure
// /images/{id}/metadata.json - metadata
// /images/{id}/image.png     - image binary

export async function storeImage(image: Image): Promise<void> {
  return withPersistenceLock("collection:images", () => writeImage(image));
}

async function writeImage(image: Image): Promise<void> {
  try {
    const imagePath = `${COLLECTION}/${image.id}`;

    const blob = opfs.isDataUrl(image.data)
      ? opfs.dataUrlToBlob(image.data)
      : new Blob([image.data], { type: "image/png" });

    const meta: StoredImageMeta = {
      id: image.id,
      title: image.title,
      created: image.created?.toISOString() ?? null,
      updated: image.updated?.toISOString() ?? null,
      model: image.model,
      prompt: image.prompt,
    };

    await opfs.writeBlob(`${imagePath}/image.png`, blob);
    await opfs.writeJson(`${imagePath}/metadata.json`, meta);
    // Clean up legacy file if present
    try {
      await opfs.deleteFile(`${imagePath}/image.bin`);
    } catch {
      /* ignore */
    }

    // Update index
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

    // Try new folder structure first
    const meta = await opfs.readJson<StoredImageMeta>(`${imagePath}/metadata.json`);

    if (!meta) return undefined;

    // Load image (legacy files used .bin instead of .png). Stamp image/png so a
    // legacy `.bin` read-back type (application/macbinary on Safari) can't leak
    // into the data URL.
    const blob = (await opfs.readBlob(`${imagePath}/image.png`)) ?? (await opfs.readBlob(`${imagePath}/image.bin`));
    const data = blob ? await opfs.blobToDataUrl(blob, "image/png") : "";

    return {
      ...meta,
      id,
      data,
      created: meta.created ? new Date(meta.created) : null,
      updated: meta.updated ? new Date(meta.updated) : null,
    };
  } catch (error) {
    console.error(`Error loading image ${id} from OPFS:`, error);
    return undefined;
  }
}

export async function removeImage(id: string): Promise<void> {
  return withPersistenceLock("collection:images", () => deleteImageFiles(id));
}

async function deleteImageFiles(id: string): Promise<void> {
  try {
    // Delete entire folder (includes metadata.json and image.bin)
    await opfs.deleteDirectory(`${COLLECTION}/${id}`);

    // Update index
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
