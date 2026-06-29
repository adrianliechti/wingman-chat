import { FileCode2, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import type { SkillResource } from "@/features/skills/lib/skillParser";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { isDataUrl } from "@/shared/lib/opfs-core";
import { readAsDataURL } from "@/shared/lib/utils";
import { FileIcon } from "@/shared/ui/FileIcon";
import { SectionEmptyState } from "./SectionEmptyState";

interface SkillResourcesEditorProps {
  resources: SkillResource[];
  /** Omit to render a read-only listing (preview panel). */
  onChange?: (resources: SkillResource[]) => void;
}

/** Approximate on-disk byte size of a resource for display. */
function resourceBytes(r: SkillResource): number {
  if (isDataUrl(r.content)) {
    const base64 = r.content.slice(r.content.indexOf(",") + 1);
    return Math.round((base64.length * 3) / 4);
  }
  return new TextEncoder().encode(r.content).length;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read an uploaded file into a resource: text inline, binary as a data URL. */
async function fileToResource(file: File): Promise<SkillResource> {
  const path = file.name;
  const contentType = inferContentTypeFromPath(path) || file.type || undefined;
  const content = isTextContentType(contentType) ? await file.text() : await readAsDataURL(file);
  return { path, content, contentType };
}

export function SkillResourcesEditor({ resources, onChange }: SkillResourcesEditorProps) {
  const readOnly = !onChange;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const addFiles = async (files: FileList | File[]) => {
    if (!onChange) return;
    const incoming = await Promise.all(Array.from(files).map(fileToResource));
    if (incoming.length === 0) return;
    // New files overwrite same-path entries, then append the rest.
    const byPath = new Map(resources.map((r) => [r.path, r]));
    for (const r of incoming) byPath.set(r.path, r);
    onChange(Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path)));
  };

  const removeResource = (path: string) => {
    if (!onChange) return;
    onChange(resources.filter((r) => r.path !== path));
    if (expanded === path) setExpanded(null);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Drag-and-drop needs drag events on the surface; the Add action and empty-state card provide the accessible path.
    <div
      className="relative"
      onDragOver={
        readOnly
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation(); // don't trigger the panel-level "import skills" overlay
              setIsDragOver(true);
            }
      }
      onDragLeave={readOnly ? undefined : () => setIsDragOver(false)}
      onDrop={
        readOnly
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }
      }
    >
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-400 bg-slate-100/80 backdrop-blur-sm dark:border-slate-500 dark:bg-slate-800/80">
          <div className="text-center">
            <Plus size={24} className="mx-auto mb-1 text-neutral-600 dark:text-neutral-400" />
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Drop files to add</p>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Section header — matches the agent config (Instructions / Skills / Knowledge Base). */}
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-400">
            Resources
          </span>
          {resources.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-neutral-100/60 px-1.5 text-[10px] font-medium tabular-nums text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400">
              {resources.length}
            </span>
          )}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={openPicker}
            className="flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {resources.length === 0 ? (
        <SectionEmptyState
          icon={<FileCode2 size={12} />}
          label={readOnly ? "No resources" : "No resources yet"}
          description={readOnly ? undefined : "Upload scripts, references, or assets"}
          onClick={readOnly ? undefined : openPicker}
        />
      ) : (
        <div className="space-y-0.5">
          {resources.map((r) => {
            const isText = !isDataUrl(r.content);
            const isOpen = expanded === r.path;
            return (
              <div key={r.path}>
                <div className="group flex items-center gap-2 rounded-lg py-1.5 transition-colors hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <FileIcon name={r.path} contentType={r.contentType} size={13} />
                    <span
                      className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300"
                      title={r.path}
                    >
                      {r.path}
                    </span>
                  </button>
                  <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
                    {formatBytes(resourceBytes(r))}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => removeResource(r.path)}
                      title="Remove resource"
                      className="shrink-0 text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="mt-0.5 rounded-lg border border-neutral-200/60 px-2.5 py-2 dark:border-neutral-800/60">
                    {isText ? (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                        {r.content}
                      </pre>
                    ) : (
                      <p className="text-xs italic text-neutral-400 dark:text-neutral-500">
                        Binary file — not readable as text by the skill.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
