import { useState, useRef, useEffect } from 'react';
import { Plus, Folder, FileText, X, ChevronDown, Check, Edit, Trash2, Loader2 } from 'lucide-react';
import { Dialog, Transition, Button } from '@headlessui/react';
import { Fragment } from 'react';
import { useRepositories } from '../hooks/useRepositories';
import { useRepository } from '../hooks/useRepository';
import { Repository, RepositoryFile } from '../types/repository';

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
            <div className="text-slate-600 dark:text-slate-400 mb-2">
              <Plus size={32} className="mx-auto" />
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
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
                      <Button
                        onClick={cancelEditingInstructions}
                        className="px-4 py-2 text-sm bg-neutral-200 dark:bg-neutral-700 
                                 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-300 
                                 rounded-md transition-colors"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={saveInstructions}
                        className="px-4 py-2 text-sm bg-slate-600 hover:bg-slate-700 
                                 text-white rounded-md transition-colors"
                      >
                        Save Instructions
                      </Button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Instructions Display */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex gap-4">
          {/* Instructions Container */}
          <div className="flex-1">
            <div 
              onClick={startEditingInstructions}
              className="text-sm text-neutral-500 dark:text-neutral-400 bg-white/30 dark:bg-neutral-800/30 p-3 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 cursor-pointer hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-800/50 transition-colors group backdrop-blur-lg"
            >
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                  {repository.instructions ? <Edit size={12} /> : <Plus size={12} />}
                  Instructions
                </div>
              </div>
            </div>
          </div>

          {/* File Upload Container */}
          <div className="flex-1">
            <div
              className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer bg-white/30 dark:bg-neutral-800/30 backdrop-blur-lg
                ${isDragOver 
                  ? 'border-slate-400 bg-slate-50/50 dark:bg-neutral-700/70' 
                  : 'border-neutral-300 dark:border-neutral-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-800/50'
                }`}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
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
        <div className="flex-1 overflow-auto px-4 pb-4 pt-4">
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
                    ? 'bg-white/30 dark:bg-neutral-800/60 backdrop-blur-lg border-2 border-dashed border-white/50 dark:border-white/30'
                    : file.status === 'error'
                    ? 'bg-red-100/40 dark:bg-red-900/25 backdrop-blur-lg border border-red-300/40 dark:border-red-600/25'
                    : 'bg-white/40 dark:bg-neutral-800/60 backdrop-blur-lg border border-white/40 dark:border-white/25'
                } rounded-xl shadow-sm flex flex-col items-center justify-center p-2 hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all`}>
                  
                  {file.status === 'processing' ? (
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 size={20} className="animate-spin text-neutral-500 dark:text-neutral-400 mb-1" />
                      <div className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
                        {file.progress}%
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center w-full h-full">
                      <FileText size={18} className={`mb-1 flex-shrink-0 ${
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
                  <Button
                    type="button"
                    className="absolute top-1 right-1 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
                    onClick={() => removeFile(file.id)}
                    title={file.status === 'processing' ? 'Cancel upload and remove file' : 'Remove file'}
                  >
                    <X size={10} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hint section when empty */}
      {(!repository.instructions && files.length === 0) && (
        <div className="flex-1 flex items-center justify-center px-4 pb-4">
          <div className="text-center max-w-sm">
            <div className="text-neutral-400 dark:text-neutral-500 mb-2">
              <FileText size={32} className="mx-auto" />
            </div>
            <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Add content
            </h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Give instructions and add knowledge as context
            </p>
          </div>
        </div>
      )}

      {/* Repository Stats */}
      {files.length > 0 && (
        <div className="px-4 pb-4 pt-2 border-t border-neutral-200 dark:border-neutral-700/70">
          <div className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
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

  const handleCreateRepository = (name: string) => {
    createRepository(name);
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
    <div className="h-full flex flex-col rounded-xl overflow-hidden animate-in fade-in duration-200 dark:bg-neutral-900/95 dark:backdrop-blur-lg dark:border dark:border-neutral-700/50 dark:shadow-2xl">
      {/* Header with Unified Repository Selector */}
      <div className="p-4 border-b border-neutral-200 dark:border-neutral-700/70">
        <div className="relative w-full" ref={dropdownRef}>
          <Button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="relative w-full rounded-lg bg-white/60 dark:bg-neutral-800/80 py-2 pl-3 pr-10 text-left shadow-md border border-neutral-300 dark:border-neutral-600/70 focus:ring-2 focus:ring-slate-500 dark:focus:ring-slate-400 hover:border-neutral-400 dark:hover:border-neutral-500/70 transition-colors backdrop-blur-lg"
          >
            <span className="flex items-center gap-2">
              <Folder size={16} className="text-slate-600 dark:text-slate-300" />
              <span className="block truncate text-neutral-900 dark:text-neutral-100 font-medium">
                {currentRepository?.name || 'None'}
              </span>
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronDown size={16} className={`text-neutral-400 dark:text-neutral-300 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </span>
          </Button>

          {isDropdownOpen && (
            <div className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-md bg-white dark:bg-neutral-800/95 py-1 shadow-lg ring-1 ring-black ring-opacity-5 dark:ring-neutral-600/50 dark:ring-opacity-75 backdrop-blur-lg dark:border dark:border-neutral-600/50">
              {/* None Option */}
              <div
                className="group relative flex items-center justify-between px-3 py-2 w-full text-left border-b border-neutral-200 dark:border-neutral-600/70 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
                onClick={() => handleRepositorySelect(null)}
              >
                <div className="flex items-center gap-2">
                  <X size={16} className="text-slate-600 dark:text-slate-300 flex-shrink-0" />
                  <span className={`block truncate text-sm ${
                    !currentRepository
                      ? 'font-semibold text-neutral-900 dark:text-neutral-100' 
                      : 'text-neutral-700 dark:text-neutral-200'
                  }`}>
                    None
                  </span>
                </div>
              </div>

              {/* Create New Repository Option */}
              <div
                className={`group relative flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-neutral-600 ${
                  !isCreatingNew ? 'hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer' : ''
                }`}
              >
                {isCreatingNew ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Plus size={16} className="text-slate-600 dark:text-slate-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      autoFocus
                      className="flex-1 text-sm bg-white dark:bg-neutral-700 border border-slate-500 rounded px-2 py-1 text-neutral-900 dark:text-neutral-100 focus:ring-1 focus:ring-slate-500"
                      placeholder="Repository name"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        saveNewRepository();
                      }}
                      className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors"
                      title="Create"
                    >
                      <Check size={12} />
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelNewRepository();
                      }}
                      className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors"
                      title="Cancel"
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startCreatingNew();
                    }}
                    className="flex items-center gap-2 w-full text-sm text-slate-600 dark:text-slate-400 font-medium"
                  >
                    <Plus size={16} />
                    Create New Repository
                  </Button>
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
                    className="group relative flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900/20"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Folder size={16} className="text-slate-600 dark:text-slate-400 flex-shrink-0" />
                        
                      {isBeingEdited ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            autoFocus
                            className="flex-1 text-sm bg-white dark:bg-neutral-700 border border-slate-500 rounded px-2 py-1 text-neutral-900 dark:text-neutral-100 focus:ring-1 focus:ring-slate-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              saveInlineEdit();
                            }}
                            className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors"
                            title="Save"
                          >
                            <Check size={12} />
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelInlineEdit();
                            }}
                            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors"
                            title="Cancel"
                          >
                            <X size={12} />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => handleRepositorySelect(repository)}
                          className="flex items-center gap-2 flex-1 text-left min-w-0"
                        >
                          <span className={`block truncate text-sm ${
                            isCurrentRepo
                              ? 'font-semibold text-neutral-900 dark:text-neutral-100' 
                              : 'text-neutral-700 dark:text-neutral-300'
                          }`}>
                            {repository.name}
                          </span>
                        </Button>
                      )}
                    </div>
                      
                    {/* Action buttons - shown on hover/focus, hidden during inline edit */}
                    {!isBeingEdited && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ml-2">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            startInlineEdit(repository);
                          }}
                          className="p-1 text-neutral-400 hover:text-slate-600 dark:hover:text-slate-400 rounded transition-colors"
                          title="Edit repository name"
                        >
                          <Edit size={12} />
                        </Button>
                        <Button
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
                        </Button>
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
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <Folder size={48} className="text-neutral-300 dark:text-neutral-600 mb-4" />
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
            No Repository Selected
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6">
            {repositories.length === 0 
              ? "Create your first repository to organize documents and instructions"
              : "Select a repository from the dropdown above to view and manage its files"
            }
          </p>
        </div>
      )}
    </div>
  );
}
