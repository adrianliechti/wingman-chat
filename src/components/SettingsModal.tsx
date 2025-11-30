import { Fragment, useState, useEffect } from 'react';
import { X, Settings, MessageSquare, Trash2, ChevronsUpDown, Check, User, Package, Download, Upload } from 'lucide-react';
import { Dialog, Transition, Listbox } from '@headlessui/react';
import { useSettings } from '../hooks/useSettings';
import { useChat } from '../hooks/useChat';
import { useRepositories } from '../hooks/useRepositories';
import { getStorageUsage } from '../lib/db';
import { formatBytes, downloadBlob } from '../lib/utils';
import { getConfig } from '../config';
import type { Theme, LayoutMode, BackgroundPack } from '../types/settings';
import type { RepositoryFile } from '../types/repository';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const themeOptions: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const layoutOptions: { value: LayoutMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
];

// A generic, reusable Select component using Headless UI Listbox
function Select<T extends string | null>({ label, value, onChange, options, helpText, containerClassName }: { label?: string, value: T, onChange: (value: T) => void, options: { value: T, label: string }[], helpText?: string, containerClassName?: string }) {
  return (
    <div className={containerClassName}>
      {label && <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">{label}</label>}
      <Listbox value={value} onChange={onChange}>
        <Listbox.Button className="relative w-full rounded-lg bg-white dark:bg-neutral-800/60 py-2 pl-3 pr-10 text-left border border-neutral-300 dark:border-neutral-700 focus-visible:ring-2 focus-visible:ring-blue-500 data-[headlessui-state=open]:ring-2 data-[headlessui-state=open]:ring-blue-500">
          <span className="block truncate">{options.find(o => o.value === value)?.label ?? 'None'}</span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronsUpDown className="h-5 w-5 text-neutral-400" aria-hidden="true" />
          </span>
        </Listbox.Button>
        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options modal={false} anchor="bottom" className="mt-1 w-(--button-width) max-h-60 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/80 p-1 backdrop-blur-xl sm:text-sm z-10 transition duration-100 ease-in data-leave:data-closed:opacity-0">
            {options.map((option) => (
              <Listbox.Option
                key={String(option.value)}
                className="group relative cursor-pointer select-none py-2 pl-10 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 data-focus:bg-neutral-200 dark:data-focus:bg-neutral-700/80"
                value={option.value}
              >
                <span className="block truncate font-normal group-data-selected:font-semibold">{option.label}</span>
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600 dark:text-blue-400 group-data-selected:visible invisible">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </span>
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </Listbox>
      {helpText && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">{helpText}</p>}
    </div>
  );
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    theme, setTheme, layoutMode, setLayoutMode,
    backgroundPacks, backgroundSetting, setBackground,
    profile, updateProfile
  } = useSettings();
  const { chats, createChat, updateChat, deleteChat } = useChat();
  const { repositories, createRepository, updateRepository, deleteRepository, upsertFile } = useRepositories();
  const [activeSection, setActiveSection] = useState('general');
  const [storageInfo, setStorageInfo] = useState<{
    totalSize: number;
    entries: Array<{ key: string; size: number }>;
    isLoading: boolean;
    error: string | null;
  }>({
    totalSize: 0,
    entries: [],
    isLoading: false,
    error: null,
  });

  // Create sections array dynamically based on config
  const sections = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'chats', label: 'Chats', icon: MessageSquare },
    ...(getConfig().repository.enabled ? [{ id: 'repositories', label: 'Repositories', icon: Package }] : []),
  ];

  // Load storage info when modal opens
  useEffect(() => {
    if (isOpen) {
      loadStorageInfo();
    }
  }, [isOpen]);

  const loadStorageInfo = async () => {
    try {
      setStorageInfo(prev => ({ ...prev, isLoading: true, error: null }));
      const usage = await getStorageUsage();
      setStorageInfo({
        totalSize: usage.totalSize,
        entries: usage.entries,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setStorageInfo(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load storage info',
      }));
    }
  };

  const deleteChats = () => {
    if (window.confirm(`Are you sure you want to delete all ${chats.length} chat${chats.length === 1 ? '' : 's'}? This action cannot be undone.`)) {
      chats.forEach(chat => deleteChat(chat.id));
      // Recalculate storage after deletion
      setTimeout(() => loadStorageInfo(), 750);
    }
  };

  const deleteRepositories = () => {
    if (window.confirm(`Are you sure you want to delete all ${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'}? This action cannot be undone and will remove all files in these repositories.`)) {
      repositories.forEach(repo => deleteRepository(repo.id));
      // Recalculate storage after deletion
      setTimeout(() => loadStorageInfo(), 750);
    }
  };

  const importRepositories = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = false;
    
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        // Read JSON file
        const jsonData = await file.text();
        const importData = JSON.parse(jsonData);
        
        // Validate import data structure
        if (!importData.repositories || !Array.isArray(importData.repositories)) {
          alert('Invalid import file: Expected repositories array not found.');
          return;
        }

        // Confirm import
        const importCount = importData.repositories.length;
        if (!window.confirm(`Import ${importCount} repositor${importCount === 1 ? 'y' : 'ies'}? This will add to your existing repositories.`)) {
          return;
        }

        // Import repositories by creating them one by one
        let importedCount = 0;
        
        for (const repoData of importData.repositories) {
          try {
            // Create a new repository and update it with imported data
            const newRepo = createRepository(repoData.name || 'Imported Repository', repoData.instructions);
            updateRepository(newRepo.id, {
              ...repoData,
              id: newRepo.id, // Keep the new ID to avoid conflicts
              // Convert date strings back to Date objects if needed
              createdAt: repoData.createdAt ? new Date(repoData.createdAt) : new Date(),
              updatedAt: repoData.updatedAt ? new Date(repoData.updatedAt) : new Date(),
            });
            
            // Import files if they exist
            if (repoData.files && Array.isArray(repoData.files)) {
              for (const fileData of repoData.files) {
                try {
                  // Create repository file with converted dates
                  const repoFile: RepositoryFile = {
                    ...fileData,
                    id: fileData.id || crypto.randomUUID(),
                    uploadedAt: fileData.uploadedAt ? new Date(fileData.uploadedAt) : new Date(),
                  };
                  
                  // Add file to repository
                  upsertFile(newRepo.id, repoFile);
                } catch (error) {
                  console.error('Failed to import file:', fileData, error);
                }
              }
            }
            
            importedCount++;
          } catch (error) {
            console.error('Failed to import repository:', repoData, error);
          }
        }

        alert(`Successfully imported ${importedCount} repositor${importedCount === 1 ? 'y' : 'ies'}.`);
        
        // Recalculate storage after import
        setTimeout(() => loadStorageInfo(), 750);
        
      } catch (error) {
        console.error('Failed to import repositories:', error);
        alert('Failed to import repositories. Please check the file format and try again.');
      }
    };

    input.click();
  };

  const exportRepositories = async () => {
    try {
      // Create export data
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        repositories: repositories.map(repo => ({
          ...repo,
          // Safely convert dates to ISO strings for JSON serialization
          createdAt: repo.createdAt ? (repo.createdAt instanceof Date ? repo.createdAt.toISOString() : repo.createdAt) : null,
          updatedAt: repo.updatedAt ? (repo.updatedAt instanceof Date ? repo.updatedAt.toISOString() : repo.updatedAt) : null,
          files: repo.files?.map(file => ({
            ...file,
            uploadedAt: file.uploadedAt ? (file.uploadedAt instanceof Date ? file.uploadedAt.toISOString() : file.uploadedAt) : null,
          })) || []
        }))
      };
      
      // Create and download JSON file
      const jsonBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const filename = `wingman-repositories-${new Date().toISOString().split('T')[0]}.json`;
      downloadBlob(jsonBlob, filename);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export repositories. Please try again.');
    }
  };

  const importChats = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = false;
    
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        // Read JSON file
        const jsonData = await file.text();
        const importData = JSON.parse(jsonData);
        
        // Validate import data structure
        if (!importData.chats || !Array.isArray(importData.chats)) {
          alert('Invalid import file: Expected chats array not found.');
          return;
        }

        // Confirm import
        const importCount = importData.chats.length;
        if (!window.confirm(`Import ${importCount} chat${importCount === 1 ? '' : 's'}? This will add to your existing chats.`)) {
          return;
        }

        // Import chats by creating them one by one
        let importedCount = 0;
        
        for (const chatData of importData.chats) {
          try {
            // Create a new chat and update it with imported data
            const newChat = createChat();
            updateChat(newChat.id, () => ({
              ...chatData,
              id: newChat.id, // Keep the new ID to avoid conflicts
              // Convert date strings back to Date objects if needed
              created: chatData.created ? new Date(chatData.created) : new Date(),
              updated: chatData.updated ? new Date(chatData.updated) : new Date(),
            }));

            importedCount++;
          } catch (error) {
            console.error('Failed to import chat:', chatData, error);
          }
        }

        alert(`Successfully imported ${importedCount} chat${importedCount === 1 ? '' : 's'}.`);
        
        // Recalculate storage after import
        setTimeout(() => loadStorageInfo(), 750);
        
      } catch (error) {
        console.error('Failed to import chats:', error);
        alert('Failed to import chats. Please check the file format and try again.');
      }
    };

    input.click();
  };

  const exportChats = async () => {
    try {
      // Create export data
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        chats: chats.map(chat => ({
          ...chat,
          // Safely convert dates to ISO strings for JSON serialization
          created: chat.created ? (chat.created instanceof Date ? chat.created.toISOString() : chat.created) : null,
          updated: chat.updated ? (chat.updated instanceof Date ? chat.updated.toISOString() : chat.updated) : null,
        }))
      };
      
      // Create and download JSON file
      const jsonBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const filename = `wingman-chats-${new Date().toISOString().split('T')[0]}.json`;
      downloadBlob(jsonBlob, filename);
    } catch (error) {
      console.error('Failed to export chats:', error);
      alert('Failed to export chats. Please try again.');
    }
  };

  const backgroundOptions = [{ value: null, label: 'None' }, ...backgroundPacks.map((p: BackgroundPack) => ({ value: p.name, label: p.name }))];
  const sectionOptions = sections.map(s => ({ value: s.id, label: s.label }));

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            <Select label="Theme" value={theme} onChange={setTheme} options={themeOptions} helpText="System will follow your device's theme setting." />
            {backgroundPacks.length > 0 && <Select label="Background" value={backgroundSetting} onChange={setBackground} options={backgroundOptions} helpText="Choose a background image pack." />}
            <Select label="Layout" value={layoutMode} onChange={setLayoutMode} options={layoutOptions} helpText="Choose between normal or wide layout for larger screens." />
          </div>
        );
      case 'profile': {
        const availableTraits = [
          'chatty', 'concise', 'friendly', 'professional', 'creative', 
          'analytical', 'patient', 'encouraging', 'direct', 'detailed'
        ];
        
        const toggleTrait = (trait: string) => {
          const currentTraits = profile.traits || [];
          const newTraits = currentTraits.includes(trait)
            ? currentTraits.filter((t: string) => t !== trait)
            : [...currentTraits, trait];
          updateProfile({ traits: newTraits });
        };

        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">Name</label>
              <input
                type="text"
                value={profile.name || ''}
                onChange={(e) => updateProfile({ name: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-neutral-800/60 border border-neutral-300 dark:border-neutral-700 focus:ring-2 focus:ring-blue-500 text-neutral-900 dark:text-neutral-100"
                placeholder="Your nickname or name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">Role</label>
              <input
                type="text"
                value={profile.role || ''}
                onChange={(e) => updateProfile({ role: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-neutral-800/60 border border-neutral-300 dark:border-neutral-700 focus:ring-2 focus:ring-blue-500 text-neutral-900 dark:text-neutral-100"
                placeholder="e.g., Software Developer, Student, Designer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">Traits</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {availableTraits.map((trait) => {
                  const isSelected = (profile.traits || []).includes(trait);
                  return (
                    <button
                      type="button"
                      key={trait}
                      onClick={() => toggleTrait(trait)}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-600'
                          : 'bg-neutral-50 dark:bg-neutral-800/40 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700/60'
                      }`}
                    >
                      {isSelected ? `− ${trait}` : `+ ${trait}`}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Click to add/remove traits for the AI's personality.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">Profile</label>
              <textarea
                value={profile.profile || ''}
                onChange={(e) => updateProfile({ profile: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-neutral-800/60 border border-neutral-300 dark:border-neutral-700 focus:ring-2 focus:ring-blue-500 text-neutral-900 dark:text-neutral-100 resize-none"
                rows={2}
                placeholder="Brief description about yourself, your interests, or context..."
              />
            </div>
          </div>
        );
      }
      case 'chats':
        return (
          <div className="space-y-6">
            {/* Storage Usage Information */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">Storage Usage</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {storageInfo.isLoading ? (
                    'Calculating storage usage...'
                  ) : storageInfo.error ? (
                    `Error: ${storageInfo.error}`
                  ) : (
                    `Local database: ${formatBytes(storageInfo.entries.find(e => e.key.includes('chat'))?.size || 0)}`
                  )}
                </p>
              </div>
            </div>

            {/* Chat Management */}
            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">Chat Management</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">You have {chats.length} chat{chats.length === 1 ? '' : 's'} saved locally.</p>
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={importChats}
                  className="flex items-center gap-3 px-0 py-2 text-sm transition-colors text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  <Upload size={16} />
                  Import Chats
                </button>
                <button
                  type="button"
                  onClick={exportChats}
                  disabled={chats.length === 0}
                  className="flex items-center gap-3 px-0 py-2 text-sm transition-colors text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:text-neutral-400 dark:disabled:text-neutral-600 disabled:cursor-not-allowed"
                >
                  <Download size={16} />
                  Export Chats
                </button>
                <button
                  type="button"
                  onClick={deleteChats}
                  disabled={chats.length === 0}
                  className="flex items-center gap-3 px-0 py-2 text-sm transition-colors text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:text-neutral-400 dark:disabled:text-neutral-600 disabled:cursor-not-allowed"
                >
                  <Trash2 size={16} />
                  Delete All
                </button>
              </div>
            </div>
          </div>
        );
      case 'repositories':
        return (
          <div className="space-y-6">
            {/* Storage Usage Information */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">Storage Usage</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {storageInfo.isLoading ? (
                    'Calculating storage usage...'
                  ) : storageInfo.error ? (
                    `Error: ${storageInfo.error}`
                  ) : (
                    `Local database: ${formatBytes(storageInfo.entries.find(e => e.key.includes('repo'))?.size || 0)}`
                  )}
                </p>
              </div>
            </div>

            {/* Repository Management */}
            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">Repository Management</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">You have {repositories.length} repositor{repositories.length === 1 ? 'y' : 'ies'} saved locally.</p>
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={importRepositories}
                  className="flex items-center gap-3 px-0 py-2 text-sm transition-colors text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  <Upload size={16} />
                  Import Repositories
                </button>
                <button
                  type="button"
                  onClick={exportRepositories}
                  disabled={repositories.length === 0}
                  className="flex items-center gap-3 px-0 py-2 text-sm transition-colors text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:text-neutral-400 dark:disabled:text-neutral-600 disabled:cursor-not-allowed"
                >
                  <Download size={16} />
                  Export Repositories
                </button>
                <button
                  type="button"
                  onClick={deleteRepositories}
                  disabled={repositories.length === 0}
                  className="flex items-center gap-3 px-0 py-2 text-sm transition-colors text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:text-neutral-400 dark:disabled:text-neutral-600 disabled:cursor-not-allowed"
                >
                  <Trash2 size={16} />
                  Delete All
                </button>
              </div>
            </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/30 dark:bg-black/50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="w-full max-w-2xl h-128 sm:h-144 transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 text-left align-middle shadow-xl transition-all flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700 shrink-0">
                  <Dialog.Title as="h3" className="hidden sm:block text-lg font-medium leading-6 text-neutral-900 dark:text-neutral-100">Settings</Dialog.Title>
                  <div className="sm:hidden flex-1 pr-4">
                    <Select 
                      value={activeSection} 
                      onChange={v => setActiveSection(v as string)} 
                      options={sectionOptions} 
                    />
                  </div>
                  <button type="button" onClick={onClose} className="p-1 rounded-full text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="flex flex-1 min-h-0">
                  <nav className="hidden sm:block w-48 border-r border-neutral-200 dark:border-neutral-800 p-1 shrink-0">
                    <div className="space-y-1">
                      {sections.map((section) => (
                        <button
                          type="button"
                          key={section.id}
                          onClick={() => setActiveSection(section.id)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors rounded-md text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 data-[active=true]:text-neutral-900 dark:data-[active=true]:text-neutral-100 data-[active=true]:bg-neutral-200 dark:data-[active=true]:bg-neutral-700/80"
                          data-active={activeSection === section.id}
                        >
                          <section.icon size={16} />
                          {section.label}
                        </button>
                      ))}
                    </div>
                  </nav>
                  <div className="flex-1 p-6 overflow-y-auto min-h-0">
                    <div className="min-h-full">
                      {renderSectionContent()}
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
