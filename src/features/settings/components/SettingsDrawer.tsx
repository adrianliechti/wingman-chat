import { useState, useEffect, Fragment } from "react";
import { Settings, MessageSquare, User, Download, Upload, Trash2, ChevronsUpDown, Check, X, ChevronRight, Bot, HardDrive } from "lucide-react";
import { Transition, Listbox } from "@headlessui/react";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { useChat } from "@/features/chat/hooks/useChat";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { getStorageUsage, clearAll, deleteDirectory, removeIndexEntry } from "@/shared/lib/opfs";
import { formatBytes } from "@/shared/lib/utils";
import type { Theme, LayoutMode, BackgroundPack, EmojiMode } from "@/shared/types/settings";
import { personaOptions } from "@/features/settings/lib/personas";
import type { PersonaKey } from "@/features/settings/lib/personas";
import { importChatsFromZip, importChatsFromLegacyJson, exportChatsAsZip } from "@/features/settings/lib/chatImportExport";
import { importAgentsFromZip, importAgentsFromLegacyJson, exportAgentsAsZip } from "@/features/settings/lib/agentImportExport";
import { rebuildAllIndexes } from "@/features/settings/lib/rebuildIndexes";
import { downloadFolderAsZip } from "@/shared/lib/opfs-zip";
import { OpfsBrowser } from "./OpfsBrowser";

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  showAdvanced?: boolean;
}

const themeOptions: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const layoutOptions: { value: LayoutMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
];

const emojiOptions: { value: EmojiMode; label: string }[] = [
  { value: "monochrome", label: "Minimal" },
  { value: "native", label: "Native" },
];

// A generic, reusable Select component using Headless UI Listbox
function Select<T extends string | null>({ label, value, onChange, options, description }: { label?: string; value: T; onChange: (value: T) => void; options: { value: T; label: string }[]; description?: string }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">{label}</label>}
      <Listbox value={value} onChange={onChange}>
        <Listbox.Button className="relative w-full rounded-lg bg-white/50 dark:bg-neutral-800/50 py-2.5 pl-3 pr-10 text-left border border-neutral-300/50 dark:border-neutral-700/50 focus-visible:ring-2 focus-visible:ring-blue-500 data-[headlessui-state=open]:ring-2 data-[headlessui-state=open]:ring-blue-500 backdrop-blur-sm transition-colors">
          <span className="block truncate text-sm">{options.find((o) => o.value === value)?.label ?? "None"}</span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronsUpDown className="h-4 w-4 text-neutral-400" aria-hidden="true" />
          </span>
        </Listbox.Button>
        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options
            anchor="bottom"
            className="mt-1 w-(--button-width) max-h-60 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/90 dark:bg-neutral-800/90 p-1 backdrop-blur-xl sm:text-sm z-[100] transition duration-100 ease-in data-leave:data-closed:opacity-0"
          >
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
      {description && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{description}</p>}
    </div>
  );
}

// Compact segmented control for small option sets
function SegmentedControl<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">{label}</label>
      <div className="flex rounded-lg overflow-hidden border border-neutral-300/50 dark:border-neutral-700/50">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-2 px-2 text-xs font-medium transition-colors truncate ${
              value === opt.value ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100" : "bg-white/50 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SectionPanelProps {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function SectionPanel({ title, icon, isOpen, onClick, children }: SectionPanelProps) {
  return (
    <div className="border-b border-neutral-200 dark:border-neutral-800">
      <button type="button" onClick={onClick} className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-neutral-700 dark:text-neutral-300">{icon}</span>
          <span className="text-base font-medium text-neutral-900 dark:text-neutral-100">{title}</span>
        </div>
        <ChevronRight size={18} className={`text-neutral-400 transition-transform duration-300 ease-out ${isOpen ? "rotate-90" : ""}`} />
      </button>
      <div className={`grid transition-all duration-300 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <div className="px-6 pb-6 pt-3 space-y-5 bg-neutral-100/30 dark:bg-neutral-900/30 shadow-[inset_0_4px_6px_-4px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_4px_6px_-4px_rgba(0,0,0,0.3)]">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SettingsDrawer({ isOpen, onClose, showAdvanced }: SettingsDrawerProps) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [opfsBrowserOpen, setOpfsBrowserOpen] = useState(false);
  const [isRebuildingIndexes, setIsRebuildingIndexes] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { theme, setTheme, layoutMode, setLayoutMode, backgroundPacks, backgroundSetting, setBackground, emojiMode, setEmojiMode, profile, updateProfile } = useSettings();
  const { chats, deleteChat } = useChat();
  const { agents } = useAgents();

  const [storageInfo, setStorageInfo] = useState<{
    totalSize: number;
    entries: Array<{ path: string; size: number }>;
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
      setStorageInfo((prev) => ({ ...prev, isLoading: true, error: null }));
      const usage = await getStorageUsage();
      setStorageInfo({
        totalSize: usage.totalSize,
        entries: usage.entries,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setStorageInfo((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load storage info",
      }));
    }
  };

  const deleteChats = () => {
    if (window.confirm(`Are you sure you want to delete all ${chats.length} chat${chats.length === 1 ? "" : "s"}? This action cannot be undone.`)) {
      chats.forEach((chat) => deleteChat(chat.id));
      setTimeout(() => loadStorageInfo(), 750);
    }
  };

  const deleteAllData = async () => {
    if (!window.confirm("Are you sure you want to delete ALL data? This includes chats, agents, images, skills, and settings. This action cannot be undone.")) {
      return;
    }

    if (!window.confirm("This is your FINAL warning. All your data will be permanently deleted. Continue?")) {
      return;
    }

    try {
      await clearAll();
      alert("All data deleted. The page will now reload.");
      window.location.reload();
    } catch (error) {
      console.error("Delete all failed:", error);
      alert("Failed to delete all data. Please try again.");
    }
  };

  const rebuildIndexes = async () => {
    if (!window.confirm("Rebuild OPFS indexes now? This will rescan chats, agents, images, skills, and repositories.")) {
      return;
    }

    try {
      setIsRebuildingIndexes(true);
      const result = await rebuildAllIndexes();
      alert(
        `Indexes rebuilt successfully.\n\n` +
          `Chats: ${result.chats}\n` +
          `Agents: ${result.agents}\n` +
          `Images: ${result.images}\n` +
          `Skills: ${result.skills}\n` +
          `Repositories: ${result.repositories}\n\n` +
          `Cleaned empty folders:\n` +
          `- Chats: ${result.cleanedChatsFolders}\n` +
          `- Agents: ${result.cleanedAgentsFolders}\n` +
          `- Images: ${result.cleanedImagesFolders}\n` +
          `- Skills: ${result.cleanedSkillsFolders}\n` +
          `- Repositories: ${result.cleanedRepositoryFolders}`,
      );
      await loadStorageInfo();
    } catch (error) {
      console.error("Rebuild indexes failed:", error);
      alert("Failed to rebuild indexes. Check console for details.");
    } finally {
      setIsRebuildingIndexes(false);
    }
  };

  const importChats = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.json";
    input.multiple = false;

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const isZip = file.name.endsWith(".zip");

      if (isZip) {
        if (!window.confirm("Import chats from ZIP? This will merge with your existing chats.")) return;
        try {
          await importChatsFromZip(file);
          alert("Chats imported successfully! Please refresh the page to see the changes.");
          window.location.reload();
        } catch (error) {
          console.error("Failed to import chats:", error);
          alert("Failed to import chats. Please check the file and try again.");
        }
      } else {
        try {
          const jsonData = await file.text();
          const parsed = JSON.parse(jsonData);
          const count = parsed.chats?.length ?? 0;
          if (!count) {
            alert("Invalid import file: Expected chats array not found.");
            return;
          }
          if (!window.confirm(`Import ${count} chat${count === 1 ? "" : "s"} from legacy format? This will add to your existing chats.`)) return;

          const result = await importChatsFromLegacyJson(jsonData);
          alert(`Successfully imported ${result.imported} chat${result.imported === 1 ? "" : "s"}. Please refresh the page to see the changes.`);
          window.location.reload();
        } catch (error) {
          console.error("Failed to import chats:", error);
          alert("Failed to import chats. Please check the file format and try again.");
        }
      }
    };

    input.click();
  };

  const exportChats = async () => {
    try {
      await exportChatsAsZip();
    } catch (error) {
      console.error("Failed to export chats:", error);
      alert("Failed to export chats. Please try again.");
    }
  };

  const exportAgents = async () => {
    try {
      await exportAgentsAsZip();
    } catch (error) {
      console.error("Failed to export agents:", error);
      alert("Failed to export agents. Please try again.");
    }
  };

  const importAgents = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.json";
    input.multiple = false;

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const isZip = file.name.endsWith(".zip");

      if (isZip) {
        if (!window.confirm("Import agents from ZIP? This will merge with your existing agents and skills.")) return;
        try {
          await importAgentsFromZip(file);
          alert("Agents imported successfully! Please refresh the page to see the changes.");
          window.location.reload();
        } catch (error) {
          console.error("Failed to import agents:", error);
          alert("Failed to import agents. Please check the file and try again.");
        }
      } else {
        try {
          const jsonData = await file.text();
          const parsed = JSON.parse(jsonData);
          const count = parsed.repositories?.length ?? 0;
          if (!count) {
            alert("Invalid import file: Expected repositories array not found.");
            return;
          }
          if (!window.confirm(`Import ${count} legacy repositor${count === 1 ? "y" : "ies"} as agents? This will add to your existing agents.`)) return;

          const result = await importAgentsFromLegacyJson(jsonData);
          alert(`Successfully imported ${result.imported} repositor${result.imported === 1 ? "y" : "ies"} as agent${result.imported === 1 ? "" : "s"}. Please refresh to see changes.`);
          window.location.reload();
        } catch (error) {
          console.error("Failed to import agents:", error);
          alert("Failed to import. Please check the file format and try again.");
        }
      }
    };

    input.click();
  };

  const deleteAgents = async () => {
    if (!window.confirm(`Are you sure you want to delete all ${agents.length} agent${agents.length === 1 ? "" : "s"}? This action cannot be undone.`)) {
      return;
    }

    try {
      for (const agent of agents) {
        await deleteDirectory(`agents/${agent.id}`);
        await removeIndexEntry("agents", agent.id);
      }
      alert("All agents deleted. The page will now reload.");
      window.location.reload();
    } catch (error) {
      console.error("Failed to delete agents:", error);
      alert("Failed to delete agents. Please try again.");
    }
  };

  const backgroundOptions = [{ value: null, label: "None" }, ...backgroundPacks.map((p: BackgroundPack) => ({ value: p.name, label: p.name }))];

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
    <>
      <Transition show={isOpen} as={Fragment}>
        <div className="fixed inset-0 z-70">
          {/* Backdrop */}
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} aria-hidden="true" />
          </Transition.Child>

          {/* Drawer */}
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="translate-x-full" enterTo="translate-x-0" leave="ease-in duration-200" leaveFrom="translate-x-0" leaveTo="translate-x-full">
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

              {/* Settings Content */}
              <div className="flex-1 overflow-y-auto">
                {/* General Section */}
                <SectionPanel title="General" icon={<Settings size={20} />} isOpen={openSection === "general"} onClick={() => toggleSection("general")}>
                  <div className="grid grid-cols-2 gap-3">
                    <SegmentedControl label="Theme" value={theme} onChange={setTheme} options={themeOptions} />
                    <SegmentedControl label="Emoji" value={emojiMode} onChange={setEmojiMode} options={emojiOptions} />
                  </div>
                  <SegmentedControl label="Layout" value={layoutMode} onChange={setLayoutMode} options={layoutOptions} />
                  {backgroundPacks.length > 0 && <Select label="Background" value={backgroundSetting} onChange={setBackground} options={backgroundOptions} />}
                </SectionPanel>

                {/* Profile Section */}
                <SectionPanel title="Profile" icon={<User size={20} />} isOpen={openSection === "profile"} onClick={() => toggleSection("profile")}>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Name</label>
                    <input
                      type="text"
                      value={profile.name || ""}
                      onChange={(e) => updateProfile({ name: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 backdrop-blur-sm transition-colors"
                      placeholder="Your nickname or name"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Role</label>
                    <input
                      type="text"
                      value={profile.role || ""}
                      onChange={(e) => updateProfile({ role: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 backdrop-blur-sm transition-colors"
                      placeholder="e.g., Software Developer, Student"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">About</label>
                    <textarea
                      value={profile.profile || ""}
                      onChange={(e) => updateProfile({ profile: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none backdrop-blur-sm transition-colors"
                      rows={5}
                      placeholder="Brief description about yourself..."
                    />
                  </div>
                </SectionPanel>

                {/* Chats Section */}
                <SectionPanel title="Chats" icon={<MessageSquare size={20} />} isOpen={openSection === "chats"} onClick={() => toggleSection("chats")}>
                  <Select
                    label="Personality"
                    value={(profile.persona || "default") as PersonaKey}
                    onChange={(value) => updateProfile({ persona: value })}
                    options={personaOptions}
                    description={personaOptions.find((p) => p.value === (profile.persona || "default"))?.description}
                  />

                  {/* Storage Info */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Storage</span>
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">
                        {chats.length} chat{chats.length === 1 ? "" : "s"} • {storageInfo.isLoading ? "..." : formatBytes(storageInfo.entries.filter((e) => e.path.startsWith("chats/")).reduce((sum, e) => sum + e.size, 0))}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={importChats}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors backdrop-blur-sm"
                      >
                        <Download size={14} />
                        Import
                      </button>
                      <button
                        type="button"
                        onClick={exportChats}
                        disabled={chats.length === 0}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                      >
                        <Upload size={14} />
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
                </SectionPanel>

                {/* Agents Section */}
                <SectionPanel title="Agents" icon={<Bot size={20} />} isOpen={openSection === "agents"} onClick={() => toggleSection("agents")}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Storage</span>
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">
                        {agents.length} agent{agents.length === 1 ? "" : "s"} • {storageInfo.isLoading ? "..." : formatBytes(storageInfo.entries.filter((e) => e.path.startsWith("agents/")).reduce((sum, e) => sum + e.size, 0))}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={importAgents}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors backdrop-blur-sm"
                      >
                        <Download size={14} />
                        Import
                      </button>
                      <button
                        type="button"
                        onClick={exportAgents}
                        disabled={agents.length === 0}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                      >
                        <Upload size={14} />
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={deleteAgents}
                        disabled={agents.length === 0}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                      >
                        <Trash2 size={14} />
                        Delete All
                      </button>
                    </div>

                    <p className="text-xs text-neutral-400 dark:text-neutral-500">Includes instructions, files, skills, and MCP server configurations</p>
                  </div>
                </SectionPanel>

                {/* Advanced — only visible via Alt+click */}
                {showAdvanced && (
                  <SectionPanel title="Advanced" icon={<HardDrive size={20} />} isOpen={openSection === "advanced"} onClick={() => toggleSection("advanced")}>
                    <div className="space-y-4">
                      {/* Storage Overview */}
                      <div className="rounded-lg bg-white/40 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Total Storage</span>
                          <span className="text-sm font-mono text-neutral-600 dark:text-neutral-400">{storageInfo.isLoading ? "..." : formatBytes(storageInfo.totalSize)}</span>
                        </div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-500">Browser Origin Private File System (OPFS)</p>
                      </div>

                      {/* Backup */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-500">Backup</span>
                        <button
                          type="button"
                          onClick={async () => {
                            setIsExporting(true);
                            try {
                              await downloadFolderAsZip("/", `wingman-backup-${new Date().toISOString().split("T")[0]}.zip`);
                            } catch (error) {
                              console.error("Export failed:", error);
                              alert("Failed to export data. Please try again.");
                            } finally {
                              setIsExporting(false);
                            }
                          }}
                          disabled={isExporting}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-neutral-300/50 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Upload size={16} className={`text-neutral-500 dark:text-neutral-400 shrink-0 ${isExporting ? "animate-pulse" : ""}`} />
                          <div className="min-w-0">
                            <div className="font-medium">{isExporting ? "Exporting..." : "Export All Data"}</div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-500 truncate">Download chats, agents, skills, and settings as ZIP</div>
                          </div>
                        </button>
                      </div>

                      {/* Diagnostic Tools */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-500">Diagnostic Tools</span>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setOpfsBrowserOpen(true)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-neutral-300/50 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 transition-colors text-left"
                          >
                            <HardDrive size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium">OPFS Browser</div>
                              <div className="text-xs text-neutral-500 dark:text-neutral-500 truncate">Browse and inspect stored files</div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={rebuildIndexes}
                            disabled={isRebuildingIndexes}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-neutral-300/50 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Settings size={16} className={`text-neutral-500 dark:text-neutral-400 shrink-0 ${isRebuildingIndexes ? "animate-spin" : ""}`} />
                            <div className="min-w-0">
                              <div className="font-medium">{isRebuildingIndexes ? "Rebuilding..." : "Rebuild Indexes"}</div>
                              <div className="text-xs text-neutral-500 dark:text-neutral-500 truncate">Rescan and repair storage indexes</div>
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Danger Zone */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-red-500/80 dark:text-red-400/80">Danger Zone</span>
                        <button
                          type="button"
                          onClick={deleteAllData}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100/50 dark:hover:bg-red-900/30 transition-colors text-left"
                        >
                          <Trash2 size={16} className="shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium">Delete All Data</div>
                            <div className="text-xs text-red-600/70 dark:text-red-400/70 truncate">Permanently remove all chats, agents, and settings</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  </SectionPanel>
                )}
              </div>
            </div>
          </Transition.Child>
        </div>
      </Transition>
      <OpfsBrowser isOpen={opfsBrowserOpen} onClose={() => setOpfsBrowserOpen(false)} />
    </>
  );
}
