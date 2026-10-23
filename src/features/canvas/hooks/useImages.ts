import { useCallback } from "react";
import type { Image } from "../types/canvas";
import { loadImages, storeImage, removeImage } from "../lib/imageStorage";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";

const storage = { load: loadImages, store: storeImage, remove: removeImage };
export function useImages() {
  const { items: images, isLoaded, create, remove } = usePersistentCollection(storage);
  const createImage = useCallback(
    (image: Omit<Image, "id" | "created" | "updated">) =>
      create({
        ...image,
        id: crypto.randomUUID(),
        created: new Date(),
        updated: new Date(),
      }),
    [create],
  );
  const deleteImage = useCallback(
    (id: string) => {
      void remove(id).catch(() => {});
    },
    [remove],
  );
  return { images, isLoaded, createImage, deleteImage };
}
