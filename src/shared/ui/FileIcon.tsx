import { Code, File, Image as ImageIcon } from "lucide-react";
import { artifactKind } from "@/features/artifacts/lib/artifacts";

// FileIcon component props
export type FileIconProps = {
  name: string;
  contentType?: string;
  size?: number;
};

// FileIcon component
export const FileIcon = ({ name, contentType, size = 16 }: FileIconProps) => {
  const kind = artifactKind(name, contentType);

  switch (kind) {
    case "code":
      return <Code size={size} className="text-blue-600 dark:text-blue-400" />;
    case "html":
      return <Code size={size} className="text-orange-600 dark:text-orange-400" />;
    case "svg":
      return <File size={size} className="text-purple-600 dark:text-purple-400" />;
    case "image":
      return <ImageIcon size={size} className="text-emerald-600 dark:text-emerald-400" />;
    case "binary":
      return <File size={size} className="text-amber-600 dark:text-amber-400" />;
    default:
      return <File size={size} className="text-neutral-600 dark:text-neutral-400" />;
  }
};
