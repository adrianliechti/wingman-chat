import { useCallback, useRef, useState } from "react";
import { useComposerDraft } from "../context/ComposerDraftProvider";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { notify } from "@/shared/lib/notify";
import { formatBytes, readAsDataURL, resizeImageBlob } from "@/shared/lib/utils";
import type { ContentPart } from "@tanstack/ai";
import { mediaFromDataUrl, type MediaPart } from "@/shared/lib/messages";

interface UseFileAttachmentsOptions {
  draftKey: string;
  visionFiles: string[];
  visionMaxFileSize?: number;
  artifactsMaxFileSize?: number;
  getTakenFileNames?: () => Promise<Set<string>>;
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

export interface UseFileAttachmentsReturn {
  attachments: ContentPart[];
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
  draftKey,
  visionFiles,
  visionMaxFileSize,
  artifactsMaxFileSize,
  getTakenFileNames,
}: UseFileAttachmentsOptions): UseFileAttachmentsReturn {
  const { draft, update, store } = useComposerDraft(draftKey);
  const { attachments, pendingFiles, pendingImages } = draft;
  const setPendingFiles = useCallback<React.Dispatch<React.SetStateAction<File[]>>>(
    (edit) => {
      update((d) => ({ ...d, pendingFiles: typeof edit === "function" ? edit(d.pendingFiles) : edit }));
    },
    [update],
  );
  const [extractingAttachments, setExtractingAttachments] = useState<Set<string>>(new Set());
  const intake = useRef(Promise.resolve());

  const handleFiles = useCallback(
    (files: File[]) => {
      const ids = files.map((file) => `${file.name}-${crypto.randomUUID()}`);
      setExtractingAttachments((prev) => new Set([...prev, ...ids]));
      const work = intake.current
        .catch(() => {})
        .then(async () => {
          await store.load(draftKey);
          if (store.get(draftKey).sending) return;
          // Normalize MIME types up front (browsers sometimes omit/guess them),
          // and dedupe names so same-named files (e.g. pasted clipboard images)
          // don't collide once they're written to the workspace by name. Names
          // must be unique against pending attachments AND files already in the
          // workspace root — listed fresh per call, so deletions free names up.
          const current = store.get(draftKey).draft;
          const taken = new Set(
            [...current.pendingFiles, ...current.pendingImages].flatMap((f) => (f ? [f.name] : [])),
          );
          if (getTakenFileNames) {
            for (const name of await getTakenFileNames()) taken.add(name);
          }

          const images: { file: File; keepOriginal: boolean }[] = [];
          const artifacts: File[] = [];
          for (const file of files) {
            const effectiveType =
              file.type && file.type !== "application/octet-stream"
                ? file.type
                : (inferContentTypeFromPath(file.name) ?? file.type);
            const uniqueName = dedupeFileName(file.name, taken);
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
              images.push({ file: effectiveFile, keepOriginal: !overArtifactLimit });
            } else {
              if (artifactsMaxFileSize != null && effectiveFile.size > artifactsMaxFileSize) {
                notify.error(
                  "File too large",
                  `"${file.name}" exceeds the ${formatBytes(artifactsMaxFileSize)} limit.`,
                );
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
            const settled = await Promise.allSettled(
              images.map(async ({ file, keepOriginal }) => {
                const blob = await resizeImageBlob(file, 1920, 1920);
                const dataUrl = await readAsDataURL(blob);
                const content = mediaFromDataUrl(dataUrl, file.name, "image");
                return { content, original: keepOriginal ? file : null };
              }),
            );

            const valid = settled
              .filter(
                (r): r is PromiseFulfilledResult<{ content: MediaPart; original: File | null }> =>
                  r.status === "fulfilled",
              )
              .map((r) => r.value);

            update((d) => ({
              ...d,
              attachments: [...d.attachments, ...valid.map((v) => v.content)],
              pendingImages: [...d.pendingImages, ...valid.map((v) => v.original)],
            }));
          }
        })
        .finally(() => {
          setExtractingAttachments((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.delete(id);
            return next;
          });
        });
      intake.current = work;
      return work;
    },
    [visionFiles, visionMaxFileSize, artifactsMaxFileSize, getTakenFileNames, store, draftKey, setPendingFiles, update],
  );

  const clearAttachments = useCallback(() => {
    update((d) => ({ ...d, attachments: [], pendingFiles: [], pendingImages: [] }));
  }, [update]);

  const removeAttachment = useCallback(
    (index: number) => {
      update((d) => ({
        ...d,
        attachments: d.attachments.filter((_, i) => i !== index),
        pendingImages: d.pendingImages.filter((_, i) => i !== index),
      }));
    },
    [update],
  );

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
