import { useCallback } from "react";
import type { Image, ImageVersion } from "../types/canvas";
import { DEFAULTS } from "../lib/recipe";
import { loadImages, storeImage, removeImage } from "../lib/imageStorage";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";

const storage = { load: loadImages, store: storeImage, remove: removeImage };

/** What callers supply; history and recipe default to a single fresh version. */
export type NewImage = Omit<Image, "id" | "created" | "updated" | "versions" | "recipe"> &
  Partial<Pick<Image, "versions" | "recipe">>;

export function newVersion(kind: ImageVersion["kind"], prompt?: string, model?: string): ImageVersion {
  return { id: crypto.randomUUID(), kind, prompt, model, created: new Date().toISOString() };
}

export function useImages() {
  const { items: images, isLoaded, create, update, remove } = usePersistentCollection(storage, "images");
  const createImage = useCallback(
    (image: NewImage) => {
      const now = new Date();
      return create({
        ...image,
        id: crypto.randomUUID(),
        created: now,
        updated: now,
        versions: image.versions?.length ? image.versions : [newVersion("generated", image.prompt, image.model)],
        recipe: image.recipe ?? DEFAULTS,
      });
    },
    [create],
  );
  const updateImage = useCallback(
    (id: string, updater: (image: Image) => Image) =>
      update(id, (image) => ({ ...updater(image), updated: new Date() })),
    [update],
  );
  const deleteImage = useCallback(
    (id: string) => {
      void remove(id).catch(() => {});
    },
    [remove],
  );
  return { images, isLoaded, createImage, updateImage, deleteImage };
}
