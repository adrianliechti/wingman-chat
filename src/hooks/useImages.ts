import { useState, useEffect, useCallback } from 'react';

import type { Image } from '../types/renderer';
import { setValue, getValue } from '../lib/db';

const IMAGES_KEY = 'images';

// Image-specific database operations
async function storeImages(images: Image[]): Promise<void> {
  try {
    await setValue(IMAGES_KEY, images);
  } catch (error) {
    console.error('error saving images to IndexedDB', error);
    throw error;
  }
}

async function loadImages(): Promise<Image[]> {
  try {
    const images = await getValue<Image[]>(IMAGES_KEY);
    
    if (!images || !Array.isArray(images)) {
      return [];
    }
    
    // Parse dates from stored data
    return images.map(img => ({
      ...img,
      created: img.created ? new Date(img.created) : null,
      updated: img.updated ? new Date(img.updated) : null,
    }));
  } catch (error) {
    console.error('error loading images from IndexedDB', error);
    return [];
  }
}

export function useImages() {
  const [images, setImages] = useState<Image[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load images on mount
  useEffect(() => {
    async function load() {
      const items = await loadImages();
      setImages(items);
      setIsLoaded(true);
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

    setImages((prev) => [...prev, newImage]);
    
    return newImage;
  }, []);

  const deleteImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
  }, []);

  // Persist images to storage when images change (skip initial empty state)
  useEffect(() => {
    if (!isLoaded) return;
    storeImages(images);
  }, [images, isLoaded]);

  return { images, createImage, deleteImage };
}
