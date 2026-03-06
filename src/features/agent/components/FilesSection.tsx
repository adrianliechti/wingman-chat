import { useState, useRef, useEffect } from 'react';
import { Folder, FileText, X, Plus, Loader2, Upload } from 'lucide-react';
import { useAgentFiles } from '@/features/agent/hooks/useAgentFiles';
import type { Agent } from '@/features/agent/types/agent';
import type { RepositoryFile } from '@/features/repository/types/repository';
import { Section } from './Section';

interface FilesSectionProps {
  agent: Agent;
}

export function FilesSection({ agent }: FilesSectionProps) {
  const { files, addFile, removeFile } = useAgentFiles(agent.id);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }
    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      await addFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false);
      dragTimeoutRef.current = null;
    }, 100);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      await addFile(file);
    }
    e.target.value = '';
  };

  return (
    <div
      className={`relative ${isDragOver ? 'bg-slate-50/50 dark:bg-slate-900/50' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
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
        icon={<Folder size={16} />}
        isOpen={true}
        collapsible={false}
      >
      <div className="space-y-2">
        {/* Upload button */}
        <button
          type="button"
          onClick={() => document.getElementById(`agent-file-upload-${agent.id}`)?.click()}
          className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
        >
          <Upload size={12} /> Upload files
        </button>
        <input
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          id={`agent-file-upload-${agent.id}`}
        />

          {/* File grid */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((file: RepositoryFile) => (
                  <div key={file.id} className="relative group" title={file.name}>
                    <div className={`relative w-16 h-16 ${
                      file.status === 'processing'
                        ? 'bg-white/30 dark:bg-neutral-900/80 backdrop-blur-lg border-2 border-dashed border-white/50 dark:border-neutral-600/60'
                        : file.status === 'error'
                        ? 'bg-red-100/40 dark:bg-red-900/25 backdrop-blur-lg border border-red-300/40 dark:border-red-600/25'
                        : 'bg-white/40 dark:bg-neutral-900/80 backdrop-blur-lg border border-white/40 dark:border-neutral-600/60'
                    } rounded-xl shadow-sm flex flex-col items-center justify-center p-1.5 hover:shadow-md transition-all`}>
                      {file.status === 'processing' ? (
                        <div className="flex flex-col items-center">
                          <Loader2 size={16} className="animate-spin text-neutral-500 dark:text-neutral-400 mb-0.5" />
                          <div className="text-[10px] text-neutral-600 dark:text-neutral-400">{file.progress}%</div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center text-center w-full">
                          <FileText size={14} className={`mb-0.5 shrink-0 ${file.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-neutral-600 dark:text-neutral-300'}`} />
                          <div className={`text-[10px] font-medium truncate w-full leading-tight ${file.status === 'error' ? 'text-red-700 dark:text-red-300' : 'text-neutral-700 dark:text-neutral-200'}`}>{file.name}</div>
                        </div>
                      )}
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 size-4 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
                        onClick={() => removeFile(file.id)}
                        title="Remove file"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
