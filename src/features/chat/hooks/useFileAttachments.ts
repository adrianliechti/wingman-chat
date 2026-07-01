import { useCallback, useRef, useState } from "react";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { notify } from "@/shared/lib/notify";
import { formatBytes, readAsDataURL, resizeImageBlob } from "@/shared/lib/utils";
import type { Content, ImageContent } from "@/shared/types/chat";

interface UseFileAttachmentsOptions {
  visionFiles: string[];
  artifactsAvailable: boolean;
  visionMaxFileSize?: number;
  artifactsMaxFileSize?: number;
}

// Browsers give pasted clipboard images a generic name (e.g. "image.png") with
// no way to distinguish them. Since attachment names become workspace file
// paths (`/${file.name}`), unresolved duplicates silently overwrite each other.
function dedupeFileName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.slice(dotIndex) : "";

  let counter = 2;
  let candidate = `${base} (${counter})${ext}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }

  used.add(candidate);
  return candidate;
}

/** Accept-attribute for the chat file picker, kept in sync with `handleFiles`' intake rule. */
export function chatAcceptString(visionFiles: string[], artifactsAvailable: boolean): string {
  return artifactsAvailable ? "" : visionFiles.join(",");
}

export interface UseFileAttachmentsReturn {
  attachments: Content[];
  pendingFiles: File[];
  /** Original image files aligned 1:1 with `attachments`, persisted at send. */
  pendingImages: (File | null)[];
  extractingAttachments: Set<string>;
  setExtractingAttachments: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  handleFiles: (files: File[]) => Promise<void>;
  clearAttachments: () => void;
  removeAttachment: (index: number) => void;
}

export function useFileAttachments({
  visionFiles,
  artifactsAvailable,
  visionMaxFileSize,
  artifactsMaxFileSize,
}: UseFileAttachmentsOptions): UseFileAttachmentsReturn {
  const [attachments, setAttachments] = useState<Content[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Original image files aligned 1:1 with `attachments`, persisted at send.
  const [pendingImages, setPendingImages] = useState<(File | null)[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState<Set<string>>(new Set());
  // Filenames already claimed by pending artifacts/images, across calls to `handleFiles`.
  const usedFileNamesRef = useRef<Set<string>>(new Set());

  const handleFiles = useCallback(
    async (files: File[]) => {
      // Normalize MIME types up front (browsers sometimes omit/guess them),
      // and dedupe names so same-named files (e.g. pasted clipboard images)
      // don't collide once they're written to the workspace by name.
      const images: { file: File; keepOriginal: boolean }[] = [];
      const artifacts: File[] = [];
      for (const file of files) {
        const effectiveType =
          file.type && file.type !== "application/octet-stream"
            ? file.type
            : (inferContentTypeFromPath(file.name) ?? file.type);
        const uniqueName = dedupeFileName(file.name, usedFileNamesRef.current);
        const effectiveFile =
          effectiveType !== file.type || uniqueName !== file.name
            ? new File([file], uniqueName, { type: effectiveType })
            : file;

        const isVisionImage = visionFiles.includes(effectiveType);
        const overArtifactLimit = artifactsMaxFileSize != null && effectiveFile.size > artifactsMaxFileSize;

        if (isVisionImage) {
          if (visionMaxFileSize != null && effectiveFile.size > visionMaxFileSize) {
            notify.error("Image too large", `"${file.name}" exceeds the ${formatBytes(visionMaxFileSize)} limit.`);
            continue;
          }
          // Sent inline as vision (resized); the original is also kept as an artifact.
          images.push({ file: effectiveFile, keepOriginal: artifactsAvailable && !overArtifactLimit });
        } else if (artifactsAvailable) {
          if (artifactsMaxFileSize != null && effectiveFile.size > artifactsMaxFileSize) {
            notify.error("File too large", `"${file.name}" exceeds the ${formatBytes(artifactsMaxFileSize)} limit.`);
          } else {
            artifacts.push(effectiveFile);
          }
        }
      }

      // Held pending until send, then written to the workspace by `sendMessage`.
      if (artifacts.length > 0) {
        setPendingFiles((prev) => [...prev, ...artifacts]);
      }

      // Resize/encode images now; keep each original (or null) aligned with its
      // attachment so removal and send stay in step.
      if (images.length > 0) {
        const ids = images.map((image, index) => `${image.file.name}-${index}`);
        setExtractingAttachments((prev) => new Set([...prev, ...ids]));

        const settled = await Promise.allSettled(
          images.map(async ({ file, keepOriginal }) => {
            const blob = await resizeImageBlob(file, 1920, 1920);
            const dataUrl = await readAsDataURL(blob);
            const content = { type: "image", name: file.name, data: dataUrl } as ImageContent;
            return { content, original: keepOriginal ? file : null };
          }),
        );

        const valid = settled
          .filter(
            (r): r is PromiseFulfilledResult<{ content: ImageContent; original: File | null }> =>
              r.status === "fulfilled",
          )
          .map((r) => r.value);

        setAttachments((prev) => [...prev, ...valid.map((v) => v.content)]);
        setPendingImages((prev) => [...prev, ...valid.map((v) => v.original)]);
        setExtractingAttachments((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
    },
    [visionFiles, artifactsAvailable, visionMaxFileSize, artifactsMaxFileSize],
  );

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setPendingFiles([]);
    setPendingImages([]);
    usedFileNamesRef.current = new Set();
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    attachments,
    pendingFiles,
    pendingImages,
    extractingAttachments,
    setExtractingAttachments,
    setPendingFiles,
    handleFiles,
    clearAttachments,
    removeAttachment,
  };
}
