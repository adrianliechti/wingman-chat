import { useState, useEffect } from 'react';
import { Plus, HardDrive, Cloud, FolderGit2 } from 'lucide-react';
import { Menu, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { RemoteFileSystemAPI } from '../lib/remoteFileSystem';
import type { RemoteFileSource } from '../types/repository';

interface RemoteFileSourcesProps {
  onFileSelect: (files: File[]) => void;
  onRemoteSourceSelect: (source: RemoteFileSource) => void;
  triggerElement?: React.ReactNode;
  className?: string;
}

export function RemoteFileSources({
  onFileSelect,
  onRemoteSourceSelect,
  triggerElement,
  className = ''
}: RemoteFileSourcesProps) {
  const [remoteSources, setRemoteSources] = useState<RemoteFileSource[]>([]);

  // Load remote sources on mount
  useEffect(() => {
    const loadRemoteSources = async () => {
      try {
        const sources = await RemoteFileSystemAPI.getSources();
        setRemoteSources(sources);
      } catch (error) {
        console.error('Failed to load remote sources:', error);
      }
    };

    loadRemoteSources();
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    onFileSelect(selectedFiles);
    // Reset input
    e.target.value = '';
  };

  const getSourceIcon = (sourceType: string) => {
    if (sourceType.toLowerCase().startsWith('git') || sourceType.toLowerCase().endsWith('git')) {
      return FolderGit2;
    }

    return Cloud;
  };

  return (
    <>
      {remoteSources.length === 0 ? (
        // If no remote sources, directly trigger local file picker
        triggerElement ? (
          <div
            className="cursor-pointer"
            onClick={() => document.getElementById('file-upload-remote')?.click()}
          >
            {triggerElement}
          </div>
        ) : (
          <button
            className="w-full border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer bg-white/30 dark:bg-neutral-800/30 backdrop-blur-lg border-neutral-300 dark:border-neutral-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-800/50"
            onClick={() => document.getElementById('file-upload-remote')?.click()}
          >
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                <Plus size={12} />
                Knowledge
              </div>
            </div>
          </button>
        )
      ) : (
        // If remote sources exist, show the menu
        <Menu as="div" className={`relative ${className}`}>
          {triggerElement ? (
            <Menu.Button as="div" className="cursor-pointer">
              {triggerElement}
            </Menu.Button>
          ) : (
            <Menu.Button
              className="w-full border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer bg-white/30 dark:bg-neutral-800/30 backdrop-blur-lg border-neutral-300 dark:border-neutral-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-800/50"
            >
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                  <Plus size={12} />
                  Knowledge
                </div>
              </div>
            </Menu.Button>
          )}

          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items className="absolute z-20 mt-1 overflow-auto rounded-md bg-white dark:bg-neutral-800/95 py-1 shadow-lg ring-1 ring-black ring-opacity-5 dark:ring-neutral-600/50 dark:ring-opacity-75 backdrop-blur-lg dark:border dark:border-neutral-600/50 focus:outline-none" anchor="bottom">
              {/* Local File Upload Option */}
              <Menu.Item>
                {({ active }) => (
                  <button
                    className={`${
                      active ? 'bg-slate-50 dark:bg-slate-700/30' : ''
                    } group relative flex items-center gap-3 px-3 py-2 w-full text-left`}
                    onClick={() => {
                      document.getElementById('file-upload-remote')?.click();
                    }}
                  >
                    <HardDrive size={16} className="text-slate-600 dark:text-slate-400 flex-shrink-0" />
                    <span className="block truncate text-sm text-neutral-700 dark:text-neutral-200">
                      Select File
                    </span>
                  </button>
                )}
              </Menu.Item>

              {/* Remote Sources */}
              {remoteSources.map((source) => {
                const IconComponent = getSourceIcon(source.id);
                return (
                  <Menu.Item key={source.id}>
                    {({ active }) => (
                      <button
                        className={`${
                          active ? 'bg-slate-50 dark:bg-slate-700/30' : ''
                        } group relative flex items-center gap-3 px-3 py-2 w-full text-left`}
                        onClick={() => onRemoteSourceSelect(source)}
                      >
                        <IconComponent size={16} className="text-slate-600 dark:text-slate-400 flex-shrink-0" />
                        <span className="block truncate text-sm text-neutral-700 dark:text-neutral-200">
                          {source.name}
                        </span>
                      </button>
                    )}
                  </Menu.Item>
                );
              })}
            </Menu.Items>
          </Transition>
        </Menu>
      )}

      {/* Hidden file input */}
      <input
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        id="file-upload-remote"
      />
    </>
  );
}
