import { FileText, Upload, X } from "lucide-react";
import { type Dispatch, useRef } from "react";
import { formatBytes } from "@/shared/lib/utils";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface KnowledgeStepProps {
  pendingFiles: File[];
  dispatch: Dispatch<WizardAction>;
}

export function KnowledgeStep({ pendingFiles, dispatch }: KnowledgeStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpenFilePicker = () => {
    inputRef.current?.click();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) dispatch({ type: "ADD_FILES", files });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) dispatch({ type: "ADD_FILES", files });
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <StepHeader
        title="Add knowledge"
        description="Give your agent context by uploading reference documents — PDFs, text files, code, markdown, and more. The agent can search and draw on these during conversations. This is optional; you can always add files later."
      />

      {/* Drop zone */}
      <input ref={inputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
      <button
        type="button"
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={handleOpenFilePicker}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300/60 px-4 py-8 transition-colors hover:border-neutral-400 hover:bg-neutral-50/30 dark:border-neutral-600/60 dark:hover:border-neutral-500 dark:hover:bg-neutral-800/20"
      >
        <Upload size={24} className="text-neutral-400 dark:text-neutral-500" />
        <span className="text-center">
          <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Drop files here or click to browse
          </span>
          <span className="mt-0.5 block text-[10px] text-neutral-400 dark:text-neutral-500">
            PDF, text, markdown, and more
          </span>
        </span>
      </button>

      {/* File list */}
      {pendingFiles.length > 0 && (
        <div className="space-y-1">
          {pendingFiles.map((file, i) => (
            <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 py-1.5">
              <FileText size={14} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">{file.name}</div>
                <div className="text-[10px] text-neutral-500 dark:text-neutral-400">{formatBytes(file.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "REMOVE_FILE", index: i })}
                className="shrink-0 p-1 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <p className="text-[10px] text-neutral-400 dark:text-neutral-500 pt-1">
            Files will be processed after agent creation.
          </p>
        </div>
      )}
    </div>
  );
}
