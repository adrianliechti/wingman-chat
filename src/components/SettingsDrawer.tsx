import { useState, useEffect, Fragment } from 'react';
import { Settings, MessageSquare, User, Package, Download, Upload, Trash2, ChevronsUpDown, Check, X, ChevronRight } from 'lucide-react';
import { Transition, Listbox } from '@headlessui/react';
import { useSettings } from '../hooks/useSettings';
import { useChat } from '../hooks/useChat';
import { useRepositories } from '../hooks/useRepositories';
import { getStorageUsage } from '../lib/db';
import { formatBytes, downloadBlob } from '../lib/utils';
import { getConfig } from '../config';
import type { Theme, LayoutMode, BackgroundPack } from '../types/settings';
import type { RepositoryFile } from '../types/repository';
import { personaOptions } from '../lib/personas';
import type { PersonaKey } from '../lib/personas';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const themeOptions: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const layoutOptions: { value: LayoutMode; label: string; description?: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Centered chat with comfortable reading width' },
  { value: 'wide', label: 'Wide', description: 'Full-width chat for more content visibility' },
];

// A generic, reusable Select component using Headless UI Listbox
function Select<T extends string | null>({ label, value, onChange, options, description }: { label?: string, value: T, onChange: (value: T) => void, options: { value: T, label: string }[], description?: string }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">{label}</label>}
      <Listbox value={value} onChange={onChange}>
        <Listbox.Button className="relative w-full rounded-lg bg-white/50 dark:bg-neutral-800/50 py-2.5 pl-3 pr-10 text-left border border-neutral-300/50 dark:border-neutral-700/50 focus-visible:ring-2 focus-visible:ring-blue-500 data-[headlessui-state=open]:ring-2 data-[headlessui-state=open]:ring-blue-500 backdrop-blur-sm transition-colors">
          <span className="block truncate text-sm">{options.find(o => o.value === value)?.label ?? 'None'}</span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronsUpDown className="h-4 w-4 text-neutral-400" aria-hidden="true" />
          </span>
        </Listbox.Button>
        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options anchor="bottom" className="mt-1 w-(--button-width) max-h-60 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/90 dark:bg-neutral-800/90 p-1 backdrop-blur-xl sm:text-sm z-[100] transition duration-100 ease-in data-leave:data-closed:opacity-0">
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
      {description && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{description}</p>
      )}
    </div>
  );
}

// Accordion section component
interface AccordionSectionProps {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function AccordionSection({ title, icon, isOpen, onClick, children }: AccordionSectionProps) {
  return (
    <div className="border-b border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-neutral-700 dark:text-neutral-300">{icon}</span>
          <span className="text-base font-medium text-neutral-900 dark:text-neutral-100">{title}</span>
        </div>
        <ChevronRight 
          size={18} 
          className={`text-neutral-400 transition-transform duration-300 ease-out ${isOpen ? 'rotate-90' : ''}`}
        />
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-6 pt-3 space-y-5 bg-neutral-100/30 dark:bg-neutral-900/30 shadow-[inset_0_4px_6px_-4px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_4px_6px_-4px_rgba(0,0,0,0.3)]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsDrawer({ isOpen, onClose }: SettingsDrawerProps) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const {
    theme, setTheme, layoutMode, setLayoutMode,
    backgroundPacks, backgroundSetting, setBackground,
    profile, updateProfile
  } = useSettings();
  const { chats, createChat, updateChat, deleteChat } = useChat();
  const { repositories, createRepository, updateRepository, deleteRepository, upsertFile } = useRepositories();
  
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

  // Load storage info when drawer opens
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
      setTimeout(() => loadStorageInfo(), 750);
    }
  };

  const deleteRepositories = () => {
    if (window.confirm(`Are you sure you want to delete all ${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'}? This action cannot be undone and will remove all files in these repositories.`)) {
      repositories.forEach(repo => deleteRepository(repo.id));
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
        const jsonData = await file.text();
        const importData = JSON.parse(jsonData);
        
        if (!importData.repositories || !Array.isArray(importData.repositories)) {
          alert('Invalid import file: Expected repositories array not found.');
          return;
        }

        const importCount = importData.repositories.length;
        if (!window.confirm(`Import ${importCount} repositor${importCount === 1 ? 'y' : 'ies'}? This will add to your existing repositories.`)) {
          return;
        }

        let importedCount = 0;
        
        for (const repoData of importData.repositories) {
          try {
            const newRepo = createRepository(repoData.name || 'Imported Repository', repoData.instructions);
            updateRepository(newRepo.id, {
              ...repoData,
              id: newRepo.id,
              createdAt: repoData.createdAt ? new Date(repoData.createdAt) : new Date(),
              updatedAt: repoData.updatedAt ? new Date(repoData.updatedAt) : new Date(),
            });
            
            if (repoData.files && Array.isArray(repoData.files)) {
              for (const fileData of repoData.files) {
                try {
                  const repoFile: RepositoryFile = {
                    ...fileData,
                    id: fileData.id || crypto.randomUUID(),
                    uploadedAt: fileData.uploadedAt ? new Date(fileData.uploadedAt) : new Date(),
                  };
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
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        repositories: repositories.map(repo => ({
          ...repo,
          createdAt: repo.createdAt ? (repo.createdAt instanceof Date ? repo.createdAt.toISOString() : repo.createdAt) : null,
          updatedAt: repo.updatedAt ? (repo.updatedAt instanceof Date ? repo.updatedAt.toISOString() : repo.updatedAt) : null,
          files: repo.files?.map(file => ({
            ...file,
            uploadedAt: file.uploadedAt ? (file.uploadedAt instanceof Date ? file.uploadedAt.toISOString() : file.uploadedAt) : null,
          })) || []
        }))
      };
      
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
        const jsonData = await file.text();
        const importData = JSON.parse(jsonData);
        
        if (!importData.chats || !Array.isArray(importData.chats)) {
          alert('Invalid import file: Expected chats array not found.');
          return;
        }

        const importCount = importData.chats.length;
        if (!window.confirm(`Import ${importCount} chat${importCount === 1 ? '' : 's'}? This will add to your existing chats.`)) {
          return;
        }

        let importedCount = 0;
        
        for (const chatData of importData.chats) {
          try {
            const newChat = createChat();
            updateChat(newChat.id, () => ({
              ...chatData,
              id: newChat.id,
              created: chatData.created ? new Date(chatData.created) : new Date(),
              updated: chatData.updated ? new Date(chatData.updated) : new Date(),
            }));

            importedCount++;
          } catch (error) {
            console.error('Failed to import chat:', chatData, error);
          }
        }

        alert(`Successfully imported ${importedCount} chat${importedCount === 1 ? '' : 's'}.`);
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
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        chats: chats.map(chat => ({
          ...chat,
          created: chat.created ? (chat.created instanceof Date ? chat.created.toISOString() : chat.created) : null,
          updated: chat.updated ? (chat.updated instanceof Date ? chat.updated.toISOString() : chat.updated) : null,
        }))
      };
      
      const jsonBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const filename = `wingman-chats-${new Date().toISOString().split('T')[0]}.json`;
      downloadBlob(jsonBlob, filename);
    } catch (error) {
      console.error('Failed to export chats:', error);
      alert('Failed to export chats. Please try again.');
    }
  };

  const backgroundOptions = [{ value: null, label: 'None' }, ...backgroundPacks.map((p: BackgroundPack) => ({ value: p.name, label: p.name }))];

  // Reset sections when drawer opens
  useEffect(() => {
    if (isOpen) {
      setOpenSection(null);
    }
  }, [isOpen]);

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? null : section);
  };

  return (
    <Transition show={isOpen} as={Fragment}>
      <div className="fixed inset-0 z-70">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div 
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={onClose}
            aria-hidden="true"
          />
        </Transition.Child>

        {/* Drawer */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="translate-x-full"
          enterTo="translate-x-0"
          leave="ease-in duration-200"
          leaveFrom="translate-x-0"
          leaveTo="translate-x-full"
        >
          <div className="absolute inset-y-0 right-0 w-full md:w-md bg-white dark:bg-neutral-950 md:bg-white/80 md:dark:bg-neutral-950/90 backdrop-blur-md shadow-2xl flex flex-col overflow-hidden md:rounded-l-2xl md:border-l md:border-neutral-200 dark:md:border-neutral-800">
        {/* Header */}
        <div className="shrink-0 border-b border-neutral-200 dark:border-neutral-800">
          <div className="px-6 pt-6 pb-4">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 p-1.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors z-10"
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Settings</h2>
          </div>
        </div>

        {/* Accordion Content */}
        <div className="flex-1 overflow-y-auto">
            {/* General Section */}
            <AccordionSection
              title="General"
              icon={<Settings size={20} />}
              isOpen={openSection === 'general'}
              onClick={() => toggleSection('general')}
            >
              <Select 
                label="Theme" 
                value={theme} 
                onChange={setTheme} 
                options={themeOptions} 
              />
              {backgroundPacks.length > 0 && (
                <Select 
                  label="Background" 
                  value={backgroundSetting} 
                  onChange={setBackground} 
                  options={backgroundOptions} 
                />
              )}
              <Select 
                label="Layout" 
                value={layoutMode} 
                onChange={setLayoutMode} 
                options={layoutOptions}
                description={layoutOptions.find(l => l.value === layoutMode)?.description}
              />
            </AccordionSection>

            {/* Profile Section */}
            <AccordionSection
              title="Profile"
              icon={<User size={20} />}
              isOpen={openSection === 'profile'}
              onClick={() => toggleSection('profile')}
            >
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Name</label>
                <input
                  type="text"
                  value={profile.name || ''}
                  onChange={(e) => updateProfile({ name: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 backdrop-blur-sm transition-colors"
                  placeholder="Your nickname or name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Role</label>
                <input
                  type="text"
                  value={profile.role || ''}
                  onChange={(e) => updateProfile({ role: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 backdrop-blur-sm transition-colors"
                  placeholder="e.g., Software Developer, Student"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">About</label>
                <textarea
                  value={profile.profile || ''}
                  onChange={(e) => updateProfile({ profile: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none backdrop-blur-sm transition-colors"
                  rows={5}
                  placeholder="Brief description about yourself..."
                />
              </div>
            </AccordionSection>

            {/* Chats Section */}
            <AccordionSection
              title="Chats"
              icon={<MessageSquare size={20} />}
              isOpen={openSection === 'chats'}
              onClick={() => toggleSection('chats')}
            >
              <Select
                label="Personality"
                value={(profile.persona || 'default') as PersonaKey}
                onChange={(value) => updateProfile({ persona: value })}
                options={personaOptions}
                description={personaOptions.find(p => p.value === (profile.persona || 'default'))?.description}
              />

              {/* Storage Info */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Storage</span>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">
                    {chats.length} chat{chats.length === 1 ? '' : 's'} • {storageInfo.isLoading ? '...' : formatBytes(storageInfo.entries.find(e => e.key.includes('chat'))?.size || 0)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={importChats}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors backdrop-blur-sm"
                  >
                    <Upload size={14} />
                    Import
                  </button>
                  <button
                    type="button"
                    onClick={exportChats}
                    disabled={chats.length === 0}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={deleteChats}
                    disabled={chats.length === 0}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                  >
                    <Trash2 size={14} />
                    Delete All
                  </button>
                </div>

                <p className="text-xs text-neutral-400 dark:text-neutral-500">Stored locally in your browser</p>
              </div>
            </AccordionSection>

            {/* Repositories Section - Conditional */}
            {getConfig().repository && (
              <AccordionSection
                title="Repositories"
                icon={<Package size={20} />}
                isOpen={openSection === 'repositories'}
                onClick={() => toggleSection('repositories')}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Storage</span>
                    <span className="text-sm text-neutral-500 dark:text-neutral-400">
                      {repositories.length} repositor{repositories.length === 1 ? 'y' : 'ies'} • {storageInfo.isLoading ? '...' : formatBytes(storageInfo.entries.find(e => e.key.includes('repo'))?.size || 0)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={importRepositories}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors backdrop-blur-sm"
                    >
                      <Upload size={14} />
                      Import
                    </button>
                    <button
                      type="button"
                      onClick={exportRepositories}
                      disabled={repositories.length === 0}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                    >
                      <Download size={14} />
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={deleteRepositories}
                      disabled={repositories.length === 0}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                    >
                      <Trash2 size={14} />
                      Delete All
                    </button>
                  </div>

                  <p className="text-xs text-neutral-400 dark:text-neutral-500">Stored locally in your browser</p>
                </div>
              </AccordionSection>
            )}
          </div>
        </div>
          </Transition.Child>
        </div>
      </Transition>
  );
}
