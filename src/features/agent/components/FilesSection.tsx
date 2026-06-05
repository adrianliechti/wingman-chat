import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { FileText, FolderOpen, HardDrive, Loader2, Plus, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const FILES_VISIBLE_DEFAULT = 3;

import { useAgentFiles } from "@/features/agent/hooks/useAgentFiles";
import type { Agent } from "@/features/agent/types/agent";
import type { RepositoryFile } from "@/features/repository/types/repository";
import { getConfig } from "@/shared/config";
import { acceptTypes } from "@/shared/lib/convert";
import { getDriveContentUrl } from "@/shared/lib/drives";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { Section } from "./Section";
import { SectionEmptyState } from "./SectionEmptyState";

interface FilesSectionProps {
  agent: Agent;
}

export function FilesSection({ agent }: FilesSectionProps) {
  const config = getConfig();
  const { files, addFile, removeFile } = useAgentFiles(agent.id);
  const acceptFilter = acceptTypes().join(",");
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
        dragTimeoutRef.current = null;
      }

      const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
      for (const file of droppedFiles) {
        await addFile(file);
      }
    },
    [addFile],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false);
      dragTimeoutRef.current = null;
    }, 100);
  }, []);

  useEffect(() => {
    const dropZone = dropZoneRef.current;
    if (!dropZone) return;

    dropZone.addEventListener("drop", handleDrop);
    dropZone.addEventListener("dragover", handleDragOver);

    return () => {
      dropZone.removeEventListener("drop", handleDrop);
      dropZone.removeEventListener("dragover", handleDragOver);
    };
  }, [handleDrop, handleDragOver]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      await addFile(file);
    }
    e.target.value = "";
  };

  const handleDriveFiles = useCallback(
    async (selected: SelectedFile[]) => {
      for (const f of selected) {
        const url = getDriveContentUrl(f.driveId, f.id);
        const resp = await fetch(url);
        const blob = await resp.blob();
        const file = new File([blob], f.name, { type: f.mime || blob.type || "" });
        await addFile(file);
      }
    },
    [addFile],
  );

  return (
    <div ref={dropZoneRef} className={`relative ${isDragOver ? "bg-slate-50/50 dark:bg-slate-900/50" : ""}`}>
      {isDragOver && (
        <div className="absolute inset-0 z-10 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm border-2 border-dashed border-slate-400 dark:border-slate-500 rounded-lg flex items-center justify-center">
          <div className="text-center">
            <Plus size={24} className="mx-auto text-neutral-600 dark:text-neutral-400 mb-1" />
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Drop files to add</p>
          </div>
        </div>
      )}

      <Section
        title="Knowledge Base"
        icon={<FolderOpen size={12} />}
        count={files.length}
        isOpen={true}
        collapsible={false}
        headerAction={
          config.drives.length > 0 ? (
            <Menu>
              <MenuButton className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
                <Plus size={12} /> Add File
              </MenuButton>
              <MenuItems
                modal={false}
                transition
                anchor="bottom end"
                className="mt-1 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-lg py-1 z-50 min-w-40"
              >
                <MenuItem>
                  <button
                    type="button"
                    onClick={() => document.getElementById(`agent-file-upload-${agent.id}`)?.click()}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                  >
                    <Upload size={15} className="text-neutral-500" />
                    Upload
                  </button>
                </MenuItem>
                {config.drives.map((drive) => (
                  <MenuItem key={drive.id}>
                    <button
                      type="button"
                      onClick={() => setActiveDrive(drive)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                    >
                      <HardDrive size={15} className="text-neutral-500" />
                      {drive.name}
                    </button>
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
          ) : (
            <button
              type="button"
              onClick={() => document.getElementById(`agent-file-upload-${agent.id}`)?.click()}
              className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              <Plus size={12} /> Add File
            </button>
          )
        }
      >
        <div className="space-y-2">
          <input
            type="file"
            multiple
            accept={acceptFilter}
            onChange={handleFileSelect}
            className="hidden"
            id={`agent-file-upload-${agent.id}`}
          />

          {/* Empty state */}
          {files.length === 0 && (
            <SectionEmptyState
              icon={<FolderOpen size={12} />}
              label="No files yet"
              description="Upload files to give this agent context"
            />
          )}

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-0.5">
              {files
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .slice(0, showAllFiles ? undefined : FILES_VISIBLE_DEFAULT)
                .map((file: RepositoryFile) => (
                  <div
                    key={file.id}
                    className="group flex items-center gap-2 py-1.5 rounded-lg px-1 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40 transition-colors"
                  >
                    {file.status === "processing" ? (
                      <Loader2 size={13} className="shrink-0 animate-spin text-neutral-400 dark:text-neutral-500" />
                    ) : (
                      <FileText size={13} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                    )}
                    <span
                      className="flex-1 min-w-0 text-xs truncate text-neutral-700 dark:text-neutral-300"
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    {file.status === "processing" && (
                      <span className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">{file.progress}%</span>
                    )}
                    <button
                      type="button"
                      className="shrink-0 p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                      onClick={() => removeFile(file.id)}
                      title="Remove file"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              {files.length > FILES_VISIBLE_DEFAULT && (
                <button
                  type="button"
                  onClick={() => setShowAllFiles((v) => !v)}
                  className="w-full text-left px-1 py-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                >
                  {showAllFiles ? "Show less" : `+${files.length - FILES_VISIBLE_DEFAULT} more`}
                </button>
              )}
            </div>
          )}
        </div>
      </Section>

      {activeDrive && (
        <DrivePicker
          isOpen={!!activeDrive}
          onClose={() => setActiveDrive(null)}
          drive={activeDrive}
          onFilesSelected={handleDriveFiles}
          multiple
          accept={acceptFilter}
        />
      )}
    </div>
  );
}
