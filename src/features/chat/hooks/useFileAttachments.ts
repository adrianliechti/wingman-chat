import { useCallback, useState } from "react";
import { canConvert } from "@/shared/lib/convert";
import { lookupContentType, readAsDataURL, resizeImageBlob } from "@/shared/lib/utils";
import type { Content, ImageContent } from "@/shared/types/chat";

interface UseFileAttachmentsOptions {
  visionFiles: string[];
  artifactsAvailable: boolean;
}

export interface UseFileAttachmentsReturn {
  attachments: Content[];
  pendingFiles: File[];
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
}: UseFileAttachmentsOptions): UseFileAttachmentsReturn {
  const [attachments, setAttachments] = useState<Content[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState<Set<string>>(new Set());

  const handleFiles = useCallback(
    async (files: File[]) => {
      // Normalize MIME types up front (browsers sometimes omit/guess them), then
      // split into vision images (sent inline) and documents (→ artifacts).
      const imageFiles: File[] = [];
      const docFiles: File[] = [];
      for (const file of files) {
        const effectiveType =
          file.type && file.type !== "application/octet-stream"
            ? file.type
            : (lookupContentType(file.name.split(".").pop() ?? "") ?? file.type);
        const effectiveFile = effectiveType !== file.type ? new File([file], file.name, { type: effectiveType }) : file;

        // Documents require the artifacts workspace; without it, only images
        // are accepted in chat (the file picker hides doc types too).
        if (visionFiles.includes(effectiveType)) imageFiles.push(effectiveFile);
        else if (artifactsAvailable && canConvert(effectiveFile)) docFiles.push(effectiveFile);
      }

      // Documents: hold them pending until send. The actual write into the
      // workspace happens at send time — nothing is persisted if the attachment
      // is removed or never sent. Artifacts is always active when available, so
      // the model already has the tools.
      if (docFiles.length > 0) {
        setPendingFiles((prev) => [...prev, ...docFiles]);
      }

      // Images: resize/encode now (async) — shown via the extracting spinner.
      if (imageFiles.length > 0) {
        const ids = imageFiles.map((file, index) => `${file.name}-${index}`);
        setExtractingAttachments((prev) => new Set([...prev, ...ids]));

        const settled = await Promise.allSettled(
          imageFiles.map(async (file) => {
            const blob = await resizeImageBlob(file, 1920, 1920);
            const dataUrl = await readAsDataURL(blob);
            return { type: "image", name: file.name, data: dataUrl } as ImageContent;
          }),
        );

        const valid = settled
          .filter((r): r is PromiseFulfilledResult<ImageContent> => r.status === "fulfilled")
          .map((r) => r.value);

        setAttachments((prev) => [...prev, ...valid]);
        setExtractingAttachments((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
    },
    [visionFiles, artifactsAvailable],
  );

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setPendingFiles([]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    attachments,
    pendingFiles,
    extractingAttachments,
    setExtractingAttachments,
    setPendingFiles,
    handleFiles,
    clearAttachments,
    removeAttachment,
  };
}
