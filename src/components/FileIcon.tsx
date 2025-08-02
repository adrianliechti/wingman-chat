import { Code, File } from 'lucide-react';
import { artifactKind } from '../lib/artifacts';

// FileIcon component props
export type FileIconProps = {
  name: string;
  size?: number;
};

// FileIcon component
export const FileIcon = ({ name, size = 16 }: FileIconProps) => {
  const kind = artifactKind(name);
  
  switch (kind) {
    case 'code':
      return <Code size={size} className="text-blue-600 dark:text-blue-400" />;
    case 'html':
      return <Code size={size} className="text-orange-600 dark:text-orange-400" />;
    case 'svg':
      return <File size={size} className="text-purple-600 dark:text-purple-400" />;
    case 'text':
    default:
      return <File size={size} className="text-neutral-600 dark:text-neutral-400" />;
  }
};
