import { useState, useRef, useEffect } from 'react';
import { Plus, Folder, FileText, X, ChevronDown, Check, Edit, Trash2, Loader2, BookOpen, Target, RefreshCw, Upload, PenLine, MessageSquare } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { useRepositories } from '../hooks/useRepositories';
import { useRepository } from '../hooks/useRepository';
import type { Repository, RepositoryFile } from '../types/repository';

interface RepositoryDetailsProps {
  repository: Repository;
}

function RepositoryDetails({ repository }: RepositoryDetailsProps) {
  const { files, addFile, removeFile, useRAG, totalPages } = useRepository(repository.id);
  const { updateRepository } = useRepositories();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [instructionsValue, setInstructionsValue] = useState('');
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    // Clear any pending timeout
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
    
    if (!isDragOver) {
      setIsDragOver(true);
    }
    
    // Clear any existing timeout and set a new one
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
    }
    
    // Reset drag state after a short delay if no more drag events
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false);
      dragTimeoutRef.current = null;
    }, 100);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
    };
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      await addFile(file);
    }
    // Reset input
    e.target.value = '';
  };

  const startEditingInstructions = () => {
    setInstructionsValue(repository.instructions || '');
    setIsEditingInstructions(true);
  };

  const saveInstructions = () => {
    updateRepository(repository.id, {
      instructions: instructionsValue.trim() || undefined
    });
    setIsEditingInstructions(false);
  };

  const cancelEditingInstructions = () => {
    setIsEditingInstructions(false);
    setInstructionsValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingInstructions();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveInstructions();
    }
  };

  return (
    <div 
      className={`relative flex flex-col flex-1 overflow-hidden ${
        isDragOver ? 'bg-slate-50/50 dark:bg-slate-900/50' : ''
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm border-2 border-dashed border-slate-400 dark:border-slate-500 rounded-lg flex items-center justify-center">
          <div className="text-center">
            <div className="text-neutral-600 dark:text-neutral-400 mb-2">
              <Plus size={32} className="mx-auto" />
            </div>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Drop files here to add to repository
            </p>
          </div>
        </div>
      )}
      {/* Instructions Edit Dialog */}
      <Transition appear show={isEditingInstructions} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={cancelEditingInstructions}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-800 p-6 text-left align-middle shadow-xl transition-all">
                  <div className="space-y-4">
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      Instructions help provide context about how the files in this repository should be used.
                    </p>
                    
                    <textarea
                      value={instructionsValue}
                      onChange={(e) => setInstructionsValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={12}
                      className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md 
                               bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100
                               focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-y min-h-[200px]"
                      placeholder="Enter instructions for this repository..."
                      autoFocus
                    />
                    
                    <div className="flex gap-3 justify-end pt-2">
                      <button
                        type="button"
                        onClick={cancelEditingInstructions}
                        className="px-4 py-2 text-sm bg-neutral-200 dark:bg-neutral-700 
                                 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-300 
                                 rounded-md transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={saveInstructions}
                        className="px-4 py-2 text-sm bg-slate-600 hover:bg-slate-700 
                                 text-white rounded-md transition-colors"
                      >
                        Save Instructions
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Instructions Display */}
      <div className="px-3 py-2">
        <div className="flex gap-3">
          {/* Instructions Container */}
          <div className="flex-1">
            <div 
              onClick={startEditingInstructions}
              className="text-sm text-neutral-500 dark:text-neutral-400 bg-white/30 dark:bg-neutral-900/60 p-3 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 cursor-pointer hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-900/80 transition-colors group backdrop-blur-lg"
            >
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                  {repository.instructions ? <Edit size={12} /> : <Plus size={12} />}
                  Instructions
                </div>
              </div>
            </div>
          </div>

          {/* File Upload Container */}
          <div className="flex-1">
            <div
              className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer bg-white/30 dark:bg-neutral-900/60 backdrop-blur-lg
                ${isDragOver 
                  ? 'border-slate-400 bg-slate-50/50 dark:bg-neutral-700/70' 
                  : 'border-neutral-300 dark:border-neutral-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-900/80'
                }`}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                  <Plus size={12} />
                  Knowledge
                </div>
              </div>
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Files list */}
      {files.length > 0 && (
        <div className="flex-1 overflow-auto px-3 py-2">
          <div className="flex flex-wrap gap-3">
            {files
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((file: RepositoryFile) => (
              <div
                key={file.id}
                className="relative group"
                title={file.name}
              >
                <div className={`relative w-20 h-20 ${
                  file.status === 'processing' 
                    ? 'bg-white/30 dark:bg-neutral-900/80 backdrop-blur-lg border-2 border-dashed border-white/50 dark:border-neutral-600/60'
                    : file.status === 'error'
                    ? 'bg-red-100/40 dark:bg-red-900/25 backdrop-blur-lg border border-red-300/40 dark:border-red-600/25'
                    : 'bg-white/40 dark:bg-neutral-900/80 backdrop-blur-lg border border-white/40 dark:border-neutral-600/60'
                } rounded-xl shadow-sm flex flex-col items-center justify-center p-2 hover:shadow-md hover:border-white/60 dark:hover:border-neutral-500/80 transition-all`}>
                  
                  {file.status === 'processing' ? (
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 size={20} className="animate-spin text-neutral-500 dark:text-neutral-400 mb-1" />
                      <div className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
                        {file.progress}%
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center w-full h-full">
                      <FileText size={18} className={`mb-1 shrink-0 ${
                        file.status === 'error' 
                          ? 'text-red-600 dark:text-red-400' 
                          : 'text-neutral-600 dark:text-neutral-300'
                      }`} />
                      <div className={`text-xs font-medium truncate w-full leading-tight ${
                        file.status === 'error' 
                          ? 'text-red-700 dark:text-red-300' 
                          : 'text-neutral-700 dark:text-neutral-200'
                      }`}>
                        {file.name}
                      </div>
                      {file.status === 'error' && (
                        <div className="text-xs mt-0.5 text-red-600 dark:text-red-400">
                          Error
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Remove button - always available */}
                  <button
                    type="button"
                    className="absolute top-1 right-1 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
                    onClick={() => removeFile(file.id)}
                    title={file.status === 'processing' ? 'Cancel upload and remove file' : 'Remove file'}
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hint section when empty */}
      {(!repository.instructions && files.length === 0) && (
        <div className="flex-1 flex items-center justify-center px-3 py-3">
          <div className="text-center max-w-xs">
            <div className="text-neutral-400 dark:text-neutral-500 mb-3">
              <FileText size={32} className="mx-auto" />
            </div>
            <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Build your knowledge base
            </h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed mb-4">
              Upload PDFs, documents, or text files to give the AI context about your project or topic.
            </p>
            <div className="text-xs text-neutral-400 dark:text-neutral-500 space-y-1.5 inline-flex flex-col items-start">
              <div className="flex items-center gap-2">
                <Upload size={12} className="shrink-0" />
                <span>Drag & drop files here</span>
              </div>
              <div className="flex items-center gap-2">
                <PenLine size={12} className="shrink-0" />
                <span>Add custom instructions</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare size={12} className="shrink-0" />
                <span>AI uses this as context</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Repository Stats */}
      {files.length > 0 && (
        <div className="shrink-0 h-14 flex items-center justify-center px-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {useRAG ? (
              <span>
                {Math.ceil(totalPages)} pages • Using RAG • Limitations may apply
              </span>
            ) : (
              <span>
                {Math.ceil(totalPages)} pages
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RepositoryDrawer() {
  const { 
    repositories, 
    currentRepository, 
    createRepository, 
    setCurrentRepository,
    updateRepository,
    deleteRepository,
    setShowRepositoryDrawer
  } = useRepositories();
  
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside dropdown to close it (but not during inline editing)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        // Only close if we're not in editing mode
        if (!inlineEditingId && !isCreatingNew) {
          setIsDropdownOpen(false);
        }
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, inlineEditingId, isCreatingNew]);

  const handleCreateRepository = async (name: string) => {
    await createRepository(name);
    setIsCreatingNew(false);
    setEditingName('');
    setIsDropdownOpen(false);
  };

  const startInlineEdit = (repository: Repository) => {
    setInlineEditingId(repository.id);
    setEditingName(repository.name);
  };

  const saveInlineEdit = () => {
    if (inlineEditingId && editingName.trim()) {
      updateRepository(inlineEditingId, { name: editingName.trim() });
      setInlineEditingId(null);
      setEditingName('');
      setIsDropdownOpen(false);
    }
  };

  const cancelInlineEdit = () => {
    setInlineEditingId(null);
    setEditingName('');
  };

  const startCreatingNew = () => {
    setIsCreatingNew(true);
    setEditingName('');
  };

  const saveNewRepository = () => {
    if (editingName.trim()) {
      handleCreateRepository(editingName.trim());
    }
  };

  const cancelNewRepository = () => {
    setIsCreatingNew(false);
    setEditingName('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    // Stop propagation to prevent any parent handlers
    e.stopPropagation();
    
    // Handle special keys
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isCreatingNew) {
        saveNewRepository();
      } else {
        saveInlineEdit();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (isCreatingNew) {
        cancelNewRepository();
      } else {
        cancelInlineEdit();
      }
    }
    // Allow all other keys (including Space) to work normally
  };

  const handleRepositorySelect = (repository: Repository | null) => {
    setCurrentRepository(repository);
    if (!repository) {
      setShowRepositoryDrawer(false);
    }
    setIsDropdownOpen(false);
  };



  return (
    <div className="h-full flex flex-col md:rounded-lg overflow-hidden transition-all duration-150 ease-linear bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md md:border md:border-neutral-200/60 md:dark:border-neutral-700/60 md:shadow-sm">
      {/* Header with Unified Repository Selector */}
      <div className="px-3 py-3 border-b border-neutral-200/60 dark:border-neutral-700/60">
        <div className="relative w-full" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="relative w-full rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-10 text-left shadow-sm border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg"
          >
            <span className="flex items-center gap-2">
              <Folder size={16} className="text-neutral-600 dark:text-neutral-300" />
              <span className="block truncate text-neutral-900 dark:text-neutral-100 font-medium">
                {currentRepository?.name || 'None'}
              </span>
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronDown size={16} className={`text-neutral-400 dark:text-neutral-300 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {isDropdownOpen && (
            <div className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/80 p-1 backdrop-blur-xl">
              {/* None Option */}
              <div
                className="group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 flex items-center gap-2"
                onClick={() => handleRepositorySelect(null)}
              >
                <X size={16} className="text-neutral-600 dark:text-neutral-300 shrink-0" />
                <span className={`block truncate text-sm ${
                  !currentRepository
                    ? 'font-semibold' 
                    : 'font-normal'
                }`}>
                  None
                </span>
              </div>

              {/* Create New Repository Option */}
              <div
                className={`group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 ${
                  !isCreatingNew ? 'hover:bg-neutral-200 dark:hover:bg-neutral-700/80' : ''
                }`}
              >
                {isCreatingNew ? (
                  <div className="flex items-center gap-1 flex-1">
                    <Plus size={16} className="text-neutral-600 dark:text-neutral-400 shrink-0" />
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      autoFocus
                      className="flex-1 text-sm bg-transparent border-0 border-b border-slate-500 rounded-none px-1 py-0 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-slate-600 dark:focus:border-slate-400"
                      placeholder="Repository name"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        saveNewRepository();
                      }}
                      className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors shrink-0"
                      title="Create"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        cancelNewRepository();
                      }}
                      className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors shrink-0"
                      title="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startCreatingNew();
                    }}
                    className="flex items-center gap-2 w-full text-sm text-neutral-600 dark:text-neutral-400 font-medium"
                  >
                    <Plus size={16} />
                    Create New Repository
                  </button>
                )}
              </div>

              {/* Existing Repositories */}
              {repositories
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((repository) => {
                const isCurrentRepo = currentRepository?.id === repository.id;
                const isBeingEdited = inlineEditingId === repository.id;
                
                return (
                  <div
                    key={`${repository.id}-${repository.name}`}
                    className="group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Folder size={16} className="text-neutral-600 dark:text-neutral-400 shrink-0" />
                        
                      {isBeingEdited ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            autoFocus
                            className="flex-1 text-sm bg-transparent border-0 border-b border-slate-500 rounded-none px-1 py-0 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-slate-600 dark:focus:border-slate-400"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            type="button"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              saveInlineEdit();
                            }}
                            className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors shrink-0"
                            title="Save"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              cancelInlineEdit();
                            }}
                            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors shrink-0"
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRepositorySelect(repository)}
                          className="flex items-center gap-2 flex-1 text-left min-w-0"
                        >
                          <span className={`block truncate text-sm ${
                            isCurrentRepo
                              ? 'font-semibold' 
                              : 'font-normal'
                          }`}>
                            {repository.name}
                          </span>
                        </button>
                      )}
                    </div>
                      
                    {/* Action buttons - shown on hover/focus, hidden during inline edit */}
                    {!isBeingEdited && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ml-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startInlineEdit(repository);
                          }}
                          className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-400 rounded transition-colors"
                          title="Edit repository name"
                        >
                          <Edit size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Are you sure you want to delete "${repository.name}"?`)) {
                              deleteRepository(repository.id);
                              if (isCurrentRepo) {
                                setCurrentRepository(null);
                              }
                            }
                          }}
                          className="p-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                          title="Delete repository"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Repository Details */}
      {currentRepository ? (
        <RepositoryDetails 
          key={currentRepository.id} 
          repository={currentRepository}
        />
      ) : (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <Folder size={48} className="text-neutral-300 dark:text-neutral-600 mb-4" />
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
            {repositories.length === 0 ? "Create a Repository" : "No Repository Selected"}
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 max-w-xs">
            {repositories.length === 0 
              ? "Repositories let you organize documents and instructions that the AI can reference during conversations."
              : "Select a repository from the dropdown above to view and manage its files."
            }
          </p>
          {repositories.length === 0 && (
            <div className="text-xs text-neutral-500 dark:text-neutral-500 space-y-2">
              <div className="flex items-center gap-2">
                <BookOpen size={12} className="shrink-0" />
                <span>Upload reference documents</span>
              </div>
              <div className="flex items-center gap-2">
                <Target size={12} className="shrink-0" />
                <span>Add custom AI instructions</span>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw size={12} className="shrink-0" />
                <span>Reuse across conversations</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
