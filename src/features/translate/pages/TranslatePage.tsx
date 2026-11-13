import { FileUp, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileWorkbench } from "../components/FileWorkbench";
import { TextWorkbench } from "../components/TextWorkbench";
import { TranslateSidebar } from "../components/TranslateSidebar";
import { useTranslate } from "../hooks/useTranslate";
import { type DriveConfig, getConfig } from "@/shared/config";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES, downloadDriveFile } from "@/shared/lib/drives";
import { notify } from "@/shared/lib/notify";
import { navButtonClassName } from "@/shared/ui/actionButton";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

async function fetchDriveFiles(selected: SelectedFile[], maxBytes: number): Promise<File[]> {
  const files: File[] = [];
  for (const entry of selected) files.push(await downloadDriveFile(entry, maxBytes));
  return files;
}

export function TranslatePage() {
  const config = getConfig();
  const { active, acceptedFiles, addFiles, newTranslation } = useTranslate();
  const { setSidebarContent } = useSidebar();
  const { setRightActions } = useNavigation();
  const [activeDrive, setActiveDrive] = useState<DriveConfig | null>(null);
  const [fetchingDrive, setFetchingDrive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sidebar = useMemo(() => <TranslateSidebar />, []);
  useEffect(() => {
    setSidebarContent(sidebar);
    return () => setSidebarContent(null);
  }, [sidebar, setSidebarContent]);

  useEffect(() => {
    setRightActions(
      <button
        type="button"
        className={navButtonClassName}
        onClick={newTranslation}
        title="New translation"
        aria-label="New translation"
      >
        <PlusIcon size={20} />
      </button>,
    );
    return () => setRightActions(null);
  }, [setRightActions, newTranslation]);

  const openFiles = useCallback(
    (files: File[]) => {
      if (files.length) void addFiles(files);
    },
    [addFiles],
  );
  const isDragging = useDropZone(containerRef, openFiles);

  // Documents pasted outside the text field open as file jobs.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) {
        event.preventDefault();
        openFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openFiles]);

  const handleDriveFiles = useCallback(
    (selected: SelectedFile[]) => {
      setFetchingDrive(true);
      fetchDriveFiles(selected, config.translator?.maxFileSize ?? DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES)
        .then(openFiles)
        .catch((error: unknown) => notify.error("Couldn't load the file", error))
        .finally(() => setFetchingDrive(false));
    },
    [config.translator?.maxFileSize, openFiles],
  );

  const accept = acceptedFiles.map((file) => file.ext).join(",");

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden pt-(--app-topbar) pb-(--safe-bottom)">
      <main ref={containerRef} className="relative flex min-h-0 w-full grow flex-col overflow-hidden">
        {(isDragging || fetchingDrive) && acceptedFiles.length > 0 && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-50/80 backdrop-blur-sm dark:bg-neutral-950/60">
            <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-neutral-400 bg-white/60 p-10 shadow-xl backdrop-blur-lg dark:border-neutral-500 dark:bg-neutral-900/60">
              <FileUp size={48} className="text-neutral-400 dark:text-neutral-500" />
              <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                {fetchingDrive ? "Loading the document…" : "Drop documents to translate them"}
              </span>
              {!fetchingDrive && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {acceptedFiles.map((file) => file.ext.toLowerCase()).join(", ")}
                </span>
              )}
            </div>
          </div>
        )}

        {active?.kind === "file" ? (
          <FileWorkbench key={active.id} job={active} />
        ) : (
          <TextWorkbench
            key={active?.id ?? "draft"}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickDrive={setActiveDrive}
          />
        )}
      </main>

      {activeDrive && (
        <DrivePicker
          isOpen
          onClose={() => setActiveDrive(null)}
          drive={activeDrive}
          onFilesSelected={handleDriveFiles}
          accept={accept}
          multiple
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        aria-label="Documents to translate"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) openFiles(Array.from(event.target.files));
          event.target.value = "";
        }}
      />
    </div>
  );
}
