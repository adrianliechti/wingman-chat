import { useState, useRef, useEffect, useCallback } from 'react';

export function useDropZone<T extends HTMLElement = HTMLElement>(
  ref: React.RefObject<T | null>,
  onFiles: (files: File[]) => void
): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      const dt = event.dataTransfer;
      if (dt?.files && dt.files.length > 0) {
        onFiles(Array.from(dt.files));
      }
    },
    [onFiles]
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.addEventListener('dragenter', handleDragEnter);
    node.addEventListener('dragover', handleDragOver);
    node.addEventListener('dragleave', handleDragLeave);
    node.addEventListener('drop', handleDrop);
    return () => {
      node.removeEventListener('dragenter', handleDragEnter);
      node.removeEventListener('dragover', handleDragOver);
      node.removeEventListener('dragleave', handleDragLeave);
      node.removeEventListener('drop', handleDrop);
    };
  }, [ref, handleDragEnter, handleDragOver, handleDragLeave, handleDrop]);

  return isDragging;
}