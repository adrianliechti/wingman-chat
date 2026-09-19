import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ChevronDown, ChevronRight, Download, Search, Upload } from "lucide-react";
import { Fragment, useState } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import type { DriveConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { getFileName } from "@/shared/lib/utils";
import type { FileEntry } from "@/shared/types/file";
import { DriveIcon } from "@/shared/ui/DriveIcon";
import { FileIcon } from "@/shared/ui/FileIcon";
import { PANEL_CLASS } from "@/shared/ui/menuStyles";
import { FileTree } from "./FileTree";

/** Above this many files the popover gets a search field. */
const SEARCH_THRESHOLD = 8;

const footerItem =
  "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100/60 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-white/5";

interface ArtifactsNavigatorProps {
  fs: FileSystemManager;
  files: FileEntry[];
  activePath: string;
  onOpen: (path: string) => void;
  /** Whether the breadcrumb opens the tree; false when the drawer shows the file column instead. */
  popover: boolean;
  drives?: DriveConfig[];
  isProcessing?: boolean;
  onUploadLocal?: () => void;
  onUploadDrive?: (drive: DriveConfig) => void;
  onDownloadAll?: () => void;
  onDownloadFile?: (path: string) => void;
}

/**
 * The active file's breadcrumb in the drawer's top bar. On a narrow drawer it is
 * the file navigator: the whole tree opens beneath it, with search once there are
 * more than a handful of files and the upload and download actions in a footer.
 */
export function ArtifactsNavigator({
  fs,
  files,
  activePath,
  onOpen,
  popover,
  drives = [],
  isProcessing = false,
  onUploadLocal,
  onUploadDrive,
  onDownloadAll,
  onDownloadFile,
}: ArtifactsNavigatorProps) {
  const [query, setQuery] = useState("");
  const folders = activePath
    .split("/")
    .filter((part) => part.length > 0)
    .slice(0, -1);
  const hasDrives = drives.length > 0 && !!onUploadDrive;
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      <FileIcon name={activePath} className="hidden shrink-0 @[18rem]:inline" />
      {folders.length > 0 && (
        <span className="hidden min-w-0 items-center gap-1 text-xs text-neutral-400 @[24rem]:flex dark:text-neutral-500">
          {folders.map((folder, i) => (
            <Fragment key={i}>
              <span className="truncate">{folder}</span>
              <ChevronRight size={10} className="shrink-0" />
            </Fragment>
          ))}
        </span>
      )}
      <span
        className="truncate text-sm font-medium text-neutral-600 md:text-xs dark:text-neutral-400"
        title={activePath}
      >
        {getFileName(activePath)}
      </span>
    </span>
  );

  if (!popover) return <div className="flex min-w-0 items-center px-1 py-0.5">{label}</div>;

  return (
    <Popover className="min-w-0">
      <PopoverButton
        className="group flex max-w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-black/5 focus-visible:outline-none dark:hover:bg-white/5"
        title="Browse files"
      >
        {label}
        <ChevronDown
          size={12}
          className="shrink-0 text-neutral-400 transition-transform duration-150 group-data-open:rotate-180"
        />
      </PopoverButton>
      <PopoverPanel transition anchor="bottom start" className={cn(PANEL_CLASS, "w-72 p-1.5 [--anchor-gap:4px]")}>
        {({ close }) => (
          <>
            {files.length > SEARCH_THRESHOLD && (
              <div className="mb-1 flex items-center gap-2 rounded-md border border-neutral-200/70 bg-neutral-50/50 px-2 py-1 dark:border-neutral-700/50 dark:bg-neutral-800/30">
                <Search size={11} className="shrink-0 text-neutral-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search files…"
                  aria-label="Search files"
                  className="min-w-0 flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                />
              </div>
            )}
            <FileTree
              className="max-h-72 overflow-auto"
              fs={fs}
              files={files}
              activePath={activePath}
              filter={query}
              expandAll={files.length <= 20}
              onOpen={(path) => {
                onOpen(path);
                close();
              }}
              onDownload={onDownloadFile}
            />
            {(onUploadLocal || hasDrives || onDownloadAll) && (
              <div className="mt-1 border-t border-neutral-200/60 pt-1 dark:border-white/10">
                {onUploadLocal && (
                  <button
                    type="button"
                    className={footerItem}
                    disabled={isProcessing}
                    onClick={() => {
                      close();
                      onUploadLocal();
                    }}
                  >
                    <Upload size={13} className="text-neutral-500" /> Upload
                  </button>
                )}
                {hasDrives &&
                  drives.map((drive) => (
                    <button
                      key={drive.id}
                      type="button"
                      className={footerItem}
                      disabled={isProcessing}
                      onClick={() => {
                        close();
                        onUploadDrive?.(drive);
                      }}
                    >
                      <DriveIcon drive={drive} /> {drive.name}
                    </button>
                  ))}
                {onDownloadAll && (
                  <button
                    type="button"
                    className={footerItem}
                    onClick={() => {
                      close();
                      onDownloadAll();
                    }}
                  >
                    <Download size={13} className="text-neutral-500" /> Download all
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}
