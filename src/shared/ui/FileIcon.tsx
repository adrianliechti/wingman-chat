import { Code, File, Image as ImageIcon } from "lucide-react";
import { artifactKind } from "@/features/artifacts/lib/artifacts";
import { cn } from "../lib/cn";

// FileIcon component props
export type FileIconProps = {
  name: string;
  contentType?: string;
  size?: number;
  className?: string;
};

// FileIcon component
export const FileIcon = ({ name, contentType, size = 16, className }: FileIconProps) => {
  const kind = artifactKind(name, contentType);

  switch (kind) {
    case "code":
      return <Code size={size} className={cn("text-blue-600 dark:text-blue-400", className)} />;
    case "html":
      return <Code size={size} className={cn("text-orange-600 dark:text-orange-400", className)} />;
    case "svg":
      return <File size={size} className={cn("text-purple-600 dark:text-purple-400", className)} />;
    case "image":
      return <ImageIcon size={size} className={cn("text-emerald-600 dark:text-emerald-400", className)} />;
    case "binary":
      return <File size={size} className={cn("text-amber-600 dark:text-amber-400", className)} />;
    default:
      return <File size={size} className={cn("text-neutral-600 dark:text-neutral-400", className)} />;
  }
};
