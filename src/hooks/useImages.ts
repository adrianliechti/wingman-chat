import { useState, useEffect, useCallback } from 'react';

import type { Image } from '../types/renderer';
import * as opfs from '../lib/opfs';

const COLLECTION = 'images';

interface StoredImageMeta {
  id: string;
  title?: string;
  created: string | null;
  updated: string | null;
  model: string;
  prompt: string;
}

// Image-specific OPFS operations using new folder structure
// /images/{id}/metadata.json - metadata
// /images/{id}/image.bin - image binary data

async function storeImage(image: Image): Promise<void> {
  try {
    const imagePath = `${COLLECTION}/${image.id}`;
    
    // Store metadata
    const meta: StoredImageMeta = {
      id: image.id,
      title: image.title,
      created: image.created?.toISOString() ?? null,
      updated: image.updated?.toISOString() ?? null,
      model: image.model,
      prompt: image.prompt,
    };
    
    await opfs.writeJson(`${imagePath}/metadata.json`, meta);
    
    // Store image data as binary
    let blob: Blob;
    if (opfs.isDataUrl(image.data)) {
      blob = opfs.dataUrlToBlob(image.data);
    } else {
      // Already binary data or other format
      blob = new Blob([image.data], { type: 'application/octet-stream' });
    }
    await opfs.writeBlob(`${imagePath}/image.bin`, blob);
    
    // Update index
    await opfs.upsertIndexEntry(COLLECTION, {
      id: image.id,
      title: image.title,
      updated: meta.updated || meta.created || new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error saving image to OPFS:', error);
    throw error;
  }
}

async function loadImage(id: string): Promise<Image | undefined> {
  try {
    const imagePath = `${COLLECTION}/${id}`;
    
    // Try new folder structure first
    const meta = await opfs.readJson<StoredImageMeta>(`${imagePath}/metadata.json`);
    
    if (meta) {
      // Load binary data
      const blob = await opfs.readBlob(`${imagePath}/image.bin`);
      const data = blob ? await opfs.blobToDataUrl(blob) : '';
      
      return {
        ...meta,
        data,
        created: meta.created ? new Date(meta.created) : null,
        updated: meta.updated ? new Date(meta.updated) : null,
      };
    }
    
    // Fall back to legacy file: /images/{id}.json
    const legacy = await opfs.readJson<{
      id: string;
      title?: string;
      created: string | null;
      updated: string | null;
      model: string;
      prompt: string;
      data: string; // blob:id reference in legacy format
    }>(`${COLLECTION}/${id}.json`);
    
    if (!legacy) return undefined;
    
    // Rehydrate blob reference from legacy central storage
    let data = legacy.data;
    const blobId = opfs.parseBlobRef(legacy.data);
    if (blobId) {
      const blob = await opfs.getBlob(blobId);
      if (blob) {
        data = await opfs.blobToDataUrl(blob);
      }
    }
    
    return {
      ...legacy,
      data,
      created: legacy.created ? new Date(legacy.created) : null,
      updated: legacy.updated ? new Date(legacy.updated) : null,
    };
  } catch (error) {
    console.error(`Error loading image ${id} from OPFS:`, error);
    return undefined;
  }
}

async function removeImage(id: string): Promise<void> {
  try {
    // Delete entire folder (includes metadata.json and image.bin)
    await opfs.deleteDirectory(`${COLLECTION}/${id}`);
    
    // Also try to delete legacy file and blob
    const legacy = await opfs.readJson<{ data: string }>(`${COLLECTION}/${id}.json`);
    if (legacy) {
      const blobId = opfs.parseBlobRef(legacy.data);
      if (blobId) {
        await opfs.deleteBlob(blobId);
      }
      await opfs.deleteFile(`${COLLECTION}/${id}.json`);
    }
    
    // Update index
    await opfs.removeIndexEntry(COLLECTION, id);
  } catch (error) {
    console.error(`Error deleting image ${id} from OPFS:`, error);
    throw error;
  }
}

async function loadImageIndex(): Promise<opfs.IndexEntry[]> {
  try {
    return await opfs.readIndex(COLLECTION);
  } catch (error) {
    console.error('Error loading image index from OPFS:', error);
    return [];
  }
}

export function useImages() {
  const [images, setImages] = useState<Image[]>([]);

  // Load images on mount
  useEffect(() => {
    async function load() {
      try {
        const index = await loadImageIndex();
        const loadedImages: Image[] = [];
        
        for (const entry of index) {
          const image = await loadImage(entry.id);
          if (image) {
            loadedImages.push(image);
          }
        }
        
        // Sort by created date (newest first)
        loadedImages.sort((a, b) => {
          const aTime = a.created?.getTime() || 0;
          const bTime = b.created?.getTime() || 0;
          return bTime - aTime;
        });
        
        setImages(loadedImages);
      } catch (error) {
        console.error('Error loading images:', error);
      }
    }

    load();
  }, []);

  const createImage = useCallback((image: Omit<Image, 'id' | 'created' | 'updated'>) => {
    const newImage: Image = {
      ...image,
      id: crypto.randomUUID(),
      created: new Date(),
      updated: new Date(),
    };

    // Keep newest images first.
    setImages((prev) => [newImage, ...prev]);
    
    // Save to OPFS
    storeImage(newImage).catch(error => {
      console.error('Error saving new image:', error);
    });
    
    return newImage;
  }, []);

  const deleteImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    
    // Remove from OPFS
    removeImage(imageId).catch(error => {
      console.error(`Error deleting image ${imageId}:`, error);
    });
  }, []);

  return { images, createImage, deleteImage };
}
