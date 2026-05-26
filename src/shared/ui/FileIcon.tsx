import {
  File,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Mail,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { artifactKind, type ArtifactKind } from "@/features/artifacts/lib/artifacts";
import { cn } from "../lib/cn";

export type FileIconProps = {
  name: string;
  contentType?: string;
  size?: number;
  className?: string;
};

const ICON_BY_KIND: Record<ArtifactKind, LucideIcon> = {
  code: FileCode,
  html: FileCode,
  svg: FileImage,
  image: FileImage,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  docx: FileText,
  pptx: Presentation,
  pdf: FileText,
  markdown: FileText,
  email: Mail,
  binary: File,
  text: FileText,
};

/**
 * Monochrome file icon — shape conveys the kind, color stays neutral so it
 * blends with surrounding UI text.
 */
export const FileIcon = ({ name, contentType, size = 16, className }: FileIconProps) => {
  const kind = artifactKind(name, contentType);
  const Icon = ICON_BY_KIND[kind] ?? FileText;
  return <Icon size={size} className={cn("text-neutral-500 dark:text-neutral-400", className)} />;
};
