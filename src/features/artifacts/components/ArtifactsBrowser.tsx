import { Download, MoreVertical, Upload } from "lucide-react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import type { DriveConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import type { FileEntry } from "@/shared/types/file";
import { DriveIcon } from "@/shared/ui/DriveIcon";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { FileTree } from "./FileTree";

export interface ArtifactsBrowserProps {
  fs: FileSystemManager;
  files: FileEntry[];
  activePath: string | null;
  onOpen: (path: string) => void;
  drives?: DriveConfig[];
  isProcessing?: boolean;
  onUploadLocal?: () => void;
  onUploadDrive?: (drive: DriveConfig) => void;
  onDownloadAll?: () => void;
  onDownloadFile?: (path: string) => void;
  className?: string;
}

/**
 * The persistent file column shown when the artifacts drawer is wide enough to
 * hold it next to a comfortable preview. Styled like the chat sidebar: a tinted
 * surface instead of a border, with upload and download in one header menu.
 */
export function ArtifactsBrowser({
  fs,
  files,
  activePath,
  onOpen,
  drives = [],
  isProcessing = false,
  onUploadLocal,
  onUploadDrive,
  onDownloadAll,
  onDownloadFile,
  className,
}: ArtifactsBrowserProps) {
  const hasDrives = drives.length > 0 && !!onUploadDrive;
  return (
    <aside
      aria-label="Files"
      className={cn("flex h-full flex-col bg-neutral-100/85 dark:bg-neutral-900/85", className)}
    >
      {/* Same height as the drawer's top bar, so the menu lines up with its controls. */}
      <div className="flex h-12 shrink-0 items-center pr-1.5 pl-3 md:h-10">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
          Files
        </span>
        {(onUploadLocal || hasDrives || onDownloadAll) && (
          <DropdownMenu
            anchor="bottom end"
            trigger={
              <MenuButton
                className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/5 dark:hover:text-neutral-200"
                aria-label="File actions"
                title="File actions"
              >
                <MoreVertical size={14} />
              </MenuButton>
            }
          >
            {onUploadLocal && (
              <DropdownMenuItem icon={<Upload size={14} />} onClick={onUploadLocal} disabled={isProcessing}>
                Upload
              </DropdownMenuItem>
            )}
            {hasDrives &&
              drives.map((drive) => (
                <DropdownMenuItem
                  key={drive.id}
                  icon={<DriveIcon drive={drive} />}
                  disabled={isProcessing}
                  onClick={() => onUploadDrive?.(drive)}
                >
                  {drive.name}
                </DropdownMenuItem>
              ))}
            {onDownloadAll && files.length > 0 && (
              <DropdownMenuItem icon={<Download size={14} />} onClick={onDownloadAll}>
                Download all
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        )}
      </div>
      <FileTree
        className="min-h-0 flex-1 overflow-auto px-1.5 pb-2"
        fs={fs}
        files={files}
        activePath={activePath}
        onOpen={onOpen}
        onDownload={onDownloadFile}
      />
    </aside>
  );
}
