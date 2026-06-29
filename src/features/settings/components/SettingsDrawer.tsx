import { Transition } from "@headlessui/react";
import {
  Bot,
  ChevronRight,
  Coffee,
  Download,
  HardDrive,
  MessageSquare,
  Mic,
  Notebook,
  Settings,
  Trash2,
  Upload,
  User,
  Wrench,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useChat } from "@/features/chat/hooks/useChat";
import { exportNotebooksAsZip, triggerNotebookImport } from "@/features/notebook/lib/notebookImportExport";
import { deleteNotebook, listNotebooks } from "@/features/notebook/lib/opfs-notebook";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { exportAgentsAsZip, triggerAgentImport } from "@/features/settings/lib/agentImportExport";
import {
  exportChatsAsZip,
  importChatsFromLegacyJson,
  importChatsFromZip,
} from "@/features/settings/lib/chatImportExport";
import type { PersonaKey } from "@/features/settings/lib/personas";
import { personaOptions } from "@/features/settings/lib/personas";
import { rebuildAllIndexes } from "@/features/settings/lib/rebuildIndexes";
import { useToolsContext } from "@/features/tools";
import { COMPANION_ID } from "@/features/tools/hooks/useCompanion";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { clearAll, deleteDirectory, getStorageUsage, removeIndexEntry } from "@/shared/lib/opfs";
import { downloadFolderAsZip } from "@/shared/lib/opfs-zip";
import { formatBytes } from "@/shared/lib/utils";
import { ProviderState } from "@/shared/types/chat";
import type { BackgroundPack, EmojiMode, LayoutMode, Theme } from "@/shared/types/settings";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";
import { SelectMenu } from "@/shared/ui/SelectMenu";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";
import { OpfsBrowser } from "./OpfsBrowser";

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  showAdvanced?: boolean;
  initialSection?: string;
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

// Compact segmented control for small option sets
function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <p className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">{label}</p>
      <div className="flex rounded-lg overflow-hidden border border-neutral-300/50 dark:border-neutral-700/50">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-2 px-2 text-xs font-medium transition-colors truncate ${
              value === opt.value
                ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
                : "bg-white/50 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
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
          className={cn("text-neutral-400 transition-transform duration-300 ease-out", isOpen && "rotate-90")}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
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

export function SettingsDrawer({ isOpen, onClose, showAdvanced, initialSection }: SettingsDrawerProps) {
  const profileNameInputId = useId();
  const profileRoleInputId = useId();
  const profileAboutInputId = useId();
  const [openSection, setOpenSection] = useState<string | null>(null);
  const { providers, getProviderState, companionEnabled, companionAvailable, toggleCompanion } = useToolsContext();
  const companion = providers.find((p) => p.id === COMPANION_ID);
  const companionState = companion ? getProviderState(companion.id) : ProviderState.Disconnected;
  const companionConnected = companionState === ProviderState.Connected && companionEnabled;
  const [opfsBrowserOpen, setOpfsBrowserOpen] = useState(false);
  const [isRebuildingIndexes, setIsRebuildingIndexes] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const {
    theme,
    setTheme,
    layoutMode,
    setLayoutMode,
    backgroundPacks,
    backgroundSetting,
    setBackground,
    emojiMode,
    setEmojiMode,
    profile,
    updateProfile,
  } = useSettings();
  const { chats, deleteChat } = useChat();
  const { agents } = useAgents();
  const {
    inputDeviceId,
    outputDeviceId,
    inputDevices,
    outputDevices,
    setInputDevice,
    setOutputDevice,
    requestPermission,
  } = useAudioDevices();

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

  const [notebooks, setNotebooks] = useState<{ id: string }[]>([]);

  const loadNotebooks = useCallback(async () => {
    try {
      setNotebooks(await listNotebooks());
    } catch (error) {
      console.error("Failed to load notebooks:", error);
    }
  }, []);

  // Load storage info when drawer opens
  const loadStorageInfo = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadStorageInfo();
      void loadNotebooks();
    }
  }, [isOpen, loadStorageInfo, loadNotebooks]);

  const deleteChats = async () => {
    if (
      await confirm({
        title: "Delete all chats?",
        message: `This permanently removes all ${chats.length} chat${chats.length === 1 ? "" : "s"} and can't be undone.`,
        danger: true,
      })
    ) {
      chats.forEach((chat) => {
        deleteChat(chat.id);
      });
      setTimeout(() => {
        void loadStorageInfo();
      }, 750);
    }
  };

  const deleteAllData = async () => {
    if (
      !(await confirm({
        title: "Delete all data?",
        message: "This permanently removes every chat, agent, image, skill, and setting. It can't be undone.",
        danger: true,
      }))
    ) {
      return;
    }

    if (
      !(await confirm({
        title: "Are you absolutely sure?",
        message: "This is your final warning. All data will be permanently deleted and cannot be recovered.",
        danger: true,
        confirmLabel: "Delete everything",
      }))
    ) {
      return;
    }

    try {
      await clearAll();
      notify.success("Data deleted", "Everything was removed. Reloading…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      console.error("Delete all failed:", error);
      notify.error("Couldn't delete data", "Something went wrong. Please try again.");
    }
  };

  const rebuildIndexes = async () => {
    if (
      !(await confirm({
        title: "Rebuild indexes?",
        message: "This rescans chats, agents, images, skills, and repositories. It may take a moment.",
      }))
    ) {
      return;
    }

    try {
      setIsRebuildingIndexes(true);
      const result = await rebuildAllIndexes();
      notify.success(
        "Indexes rebuilt",
        `${result.chats} chats, ${result.agents} agents, ${result.images} images, ${result.skills} skills, ${result.repositories} repositories.`,
      );
      await loadStorageInfo();
    } catch (error) {
      console.error("Rebuild indexes failed:", error);
      notify.error("Couldn't rebuild indexes", "Check the console for details.");
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
        if (
          !(await confirm({
            title: "Import chats?",
            message: "Chats from the ZIP will be merged with your existing chats.",
          }))
        )
          return;
        try {
          await importChatsFromZip(file);
          notify.success("Chats imported", "Reloading to show them…");
          setTimeout(() => window.location.reload(), 1200);
        } catch (error) {
          console.error("Failed to import chats:", error);
          notify.error("Couldn't import chats", "Check the file and try again.");
        }
      } else {
        try {
          const jsonData = await file.text();
          const parsed = JSON.parse(jsonData);
          const count = parsed.chats?.length ?? 0;
          if (!count) {
            notify.error("Invalid import file", "No chats were found in this file.");
            return;
          }
          if (
            !(await confirm({
              title: "Import chats?",
              message: `${count} chat${count === 1 ? "" : "s"} from the legacy file will be added to your existing chats.`,
            }))
          )
            return;

          const result = await importChatsFromLegacyJson(jsonData);
          notify.success(
            "Chats imported",
            `${result.imported} chat${result.imported === 1 ? "" : "s"} added. Reloading…`,
          );
          setTimeout(() => window.location.reload(), 1200);
        } catch (error) {
          console.error("Failed to import chats:", error);
          notify.error("Couldn't import chats", "Check the file format and try again.");
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
      notify.error("Couldn't export chats", "Something went wrong. Please try again.");
    }
  };

  const exportAgents = async () => {
    try {
      await exportAgentsAsZip();
    } catch (error) {
      console.error("Failed to export agents:", error);
      notify.error("Couldn't export agents", "Something went wrong. Please try again.");
    }
  };

  const deleteAgents = async () => {
    if (
      !(await confirm({
        title: "Delete all agents?",
        message: `This permanently removes all ${agents.length} agent${agents.length === 1 ? "" : "s"} and can't be undone.`,
        danger: true,
      }))
    ) {
      return;
    }

    try {
      for (const agent of agents) {
        await deleteDirectory(`agents/${agent.id}`);
        await removeIndexEntry("agents", agent.id);
      }
      notify.success("Agents deleted", "Reloading to apply changes…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      console.error("Failed to delete agents:", error);
      notify.error("Couldn't delete agents", "Something went wrong. Please try again.");
    }
  };

  const exportNotebooks = async () => {
    try {
      await exportNotebooksAsZip();
    } catch (error) {
      console.error("Failed to export notebooks:", error);
      notify.error("Couldn't export notebooks", "Something went wrong. Please try again.");
    }
  };

  const deleteNotebooks = async () => {
    if (
      !(await confirm({
        title: "Delete all notebooks?",
        message: `This permanently removes all ${notebooks.length} notebook${notebooks.length === 1 ? "" : "s"} and can't be undone.`,
        danger: true,
      }))
    ) {
      return;
    }

    try {
      for (const notebook of notebooks) {
        await deleteNotebook(notebook.id);
      }
      notify.success("Notebooks deleted", "Reloading to apply changes…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      console.error("Failed to delete notebooks:", error);
      notify.error("Couldn't delete notebooks", "Something went wrong. Please try again.");
    }
  };

  const backgroundOptions = [
    { value: null, label: "None" },
    ...backgroundPacks.map((p: BackgroundPack) => ({ value: p.name, label: p.name })),
  ];

  // Reset (or jump to initial) section when drawer opens
  useEffect(() => {
    if (isOpen) {
      setOpenSection(initialSection ?? null);
    }
  }, [isOpen, initialSection]);

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? null : section);
  };

  return (
    <>
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
            <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} aria-hidden="true" />
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

              {/* Settings Content */}
              <div className="flex-1 overflow-y-auto">
                {/* General Section */}
                <SectionPanel
                  title="General"
                  icon={<Settings size={20} />}
                  isOpen={openSection === "general"}
                  onClick={() => toggleSection("general")}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <SegmentedControl label="Theme" value={theme} onChange={setTheme} options={themeOptions} />
                    <SegmentedControl label="Emoji" value={emojiMode} onChange={setEmojiMode} options={emojiOptions} />
                  </div>
                  <SegmentedControl
                    label="Layout"
                    value={layoutMode}
                    onChange={setLayoutMode}
                    options={layoutOptions}
                  />
                  {backgroundPacks.length > 0 && (
                    <SelectMenu
                      label="Background"
                      value={backgroundSetting}
                      onChange={setBackground}
                      options={backgroundOptions}
                    />
                  )}
                </SectionPanel>

                {/* Audio Section */}
                <SectionPanel
                  title="Audio"
                  icon={<Mic size={20} />}
                  isOpen={openSection === "audio"}
                  onClick={() => toggleSection("audio")}
                >
                  {inputDevices.length === 0 && outputDevices.length === 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        Allow microphone access to select audio devices.
                      </p>
                      <button
                        type="button"
                        onClick={requestPermission}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors backdrop-blur-sm"
                      >
                        <Mic size={14} />
                        Allow Access
                      </button>
                    </div>
                  ) : (
                    <>
                      {inputDevices.length > 0 && (
                        <SelectMenu
                          label="Microphone"
                          value={inputDeviceId ?? null}
                          onChange={(value) => setInputDevice(value ?? undefined)}
                          options={[
                            { value: null, label: "System Default" },
                            ...inputDevices.map((d) => ({
                              value: d.deviceId,
                              label: d.label || `Microphone (${d.deviceId.slice(0, 8)})`,
                            })),
                          ]}
                        />
                      )}
                      {outputDevices.length > 0 && (
                        <SelectMenu
                          label="Speaker"
                          value={outputDeviceId ?? null}
                          onChange={(value) => setOutputDevice(value ?? undefined)}
                          options={[
                            { value: null, label: "System Default" },
                            ...outputDevices.map((d) => ({
                              value: d.deviceId,
                              label: d.label || `Speaker (${d.deviceId.slice(0, 8)})`,
                            })),
                          ]}
                        />
                      )}
                    </>
                  )}
                </SectionPanel>

                {/* Profile Section */}
                <SectionPanel
                  title="Profile"
                  icon={<User size={20} />}
                  isOpen={openSection === "profile"}
                  onClick={() => toggleSection("profile")}
                >
                  <div>
                    <label
                      htmlFor={profileNameInputId}
                      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                    >
                      Name
                    </label>
                    <input
                      id={profileNameInputId}
                      type="text"
                      value={profile.name || ""}
                      onChange={(e) => updateProfile({ name: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 backdrop-blur-sm transition-colors"
                      placeholder="Your nickname or name"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={profileRoleInputId}
                      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                    >
                      Role
                    </label>
                    <input
                      id={profileRoleInputId}
                      type="text"
                      value={profile.role || ""}
                      onChange={(e) => updateProfile({ role: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 backdrop-blur-sm transition-colors"
                      placeholder="e.g., Software Developer, Student"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={profileAboutInputId}
                      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                    >
                      About
                    </label>
                    <textarea
                      id={profileAboutInputId}
                      value={profile.profile || ""}
                      onChange={(e) => updateProfile({ profile: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none backdrop-blur-sm transition-colors"
                      rows={5}
                      placeholder="Brief description about yourself..."
                    />
                  </div>
                </SectionPanel>

                {/* Chats Section */}
                <SectionPanel
                  title="Chats"
                  icon={<MessageSquare size={20} />}
                  isOpen={openSection === "chats"}
                  onClick={() => toggleSection("chats")}
                >
                  <SelectMenu
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
                        {chats.length} chat{chats.length === 1 ? "" : "s"} •{" "}
                        {storageInfo.isLoading
                          ? "..."
                          : formatBytes(
                              storageInfo.entries
                                .filter((e) => e.path.startsWith("chats/"))
                                .reduce((sum, e) => sum + e.size, 0),
                            )}
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
                </SectionPanel>

                {/* Agents Section */}
                <SectionPanel
                  title="Agents"
                  icon={<Bot size={20} />}
                  isOpen={openSection === "agents"}
                  onClick={() => toggleSection("agents")}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Storage</span>
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">
                        {agents.length} agent{agents.length === 1 ? "" : "s"} •{" "}
                        {storageInfo.isLoading
                          ? "..."
                          : formatBytes(
                              storageInfo.entries
                                .filter((e) => e.path.startsWith("agents/"))
                                .reduce((sum, e) => sum + e.size, 0),
                            )}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={triggerAgentImport}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors backdrop-blur-sm"
                      >
                        <Upload size={14} />
                        Import
                      </button>
                      <button
                        type="button"
                        onClick={exportAgents}
                        disabled={agents.length === 0}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                      >
                        <Download size={14} />
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

                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                      Includes instructions, files, skills, and MCP server configurations
                    </p>
                  </div>
                </SectionPanel>

                {/* Notebooks Section */}
                <SectionPanel
                  title="Notebooks"
                  icon={<Notebook size={20} />}
                  isOpen={openSection === "notebooks"}
                  onClick={() => toggleSection("notebooks")}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Storage</span>
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">
                        {notebooks.length} notebook{notebooks.length === 1 ? "" : "s"} •{" "}
                        {storageInfo.isLoading
                          ? "..."
                          : formatBytes(
                              storageInfo.entries
                                .filter((e) => e.path.startsWith("notebooks/"))
                                .reduce((sum, e) => sum + e.size, 0),
                            )}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={triggerNotebookImport}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors backdrop-blur-sm"
                      >
                        <Upload size={14} />
                        Import
                      </button>
                      <button
                        type="button"
                        onClick={exportNotebooks}
                        disabled={notebooks.length === 0}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                      >
                        <Download size={14} />
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={deleteNotebooks}
                        disabled={notebooks.length === 0}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                      >
                        <Trash2 size={14} />
                        Delete All
                      </button>
                    </div>

                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                      Includes sources, chat, and generated studio outputs
                    </p>
                  </div>
                </SectionPanel>

                {/* Companion Section */}
                {companionAvailable && (
                  <SectionPanel
                    title="Companion"
                    icon={<Coffee size={20} />}
                    isOpen={openSection === "companion"}
                    onClick={() => toggleSection("companion")}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-neutral-700 dark:text-neutral-300">Enable companion</span>
                      <button
                        type="button"
                        onClick={toggleCompanion}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none ${
                          companionEnabled ? "bg-emerald-500 dark:bg-emerald-600" : "bg-neutral-300 dark:bg-neutral-600"
                        }`}
                        role="switch"
                        aria-checked={companionEnabled}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            companionEnabled ? "translate-x-4.5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>

                    {companionConnected && companion && companion.tools.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          {companion.tools.length} tool{companion.tools.length !== 1 ? "s" : ""} available
                        </p>
                        <div className="space-y-1">
                          {companion.tools.map((tool) => (
                            <div key={tool.name} className="flex items-center gap-2 py-1.5">
                              <span className="shrink-0 text-neutral-600 dark:text-neutral-400">
                                {(() => {
                                  const toolIcon =
                                    tool.icon ?? (typeof companion.icon === "string" ? companion.icon : undefined);
                                  if (toolIcon) {
                                    return <McpProviderIcon src={toolIcon} size={16} className="object-contain" />;
                                  }
                                  if (companion.icon && typeof companion.icon !== "string") {
                                    const CompanionIcon = companion.icon;
                                    return <CompanionIcon width={16} height={16} />;
                                  }
                                  return <Wrench size={16} />;
                                })()}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                  {tool.name}
                                </div>
                                {tool.description && (
                                  <div className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">
                                    {tool.description}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : companionConnected ? (
                      <p className="text-sm text-neutral-400 dark:text-neutral-500">No tools exposed</p>
                    ) : (
                      <p className="text-sm text-neutral-400 dark:text-neutral-500">
                        Enable the companion to see available tools.
                      </p>
                    )}
                  </SectionPanel>
                )}

                {/* Advanced — only visible via Alt+click */}
                {showAdvanced && (
                  <SectionPanel
                    title="Advanced"
                    icon={<HardDrive size={20} />}
                    isOpen={openSection === "advanced"}
                    onClick={() => toggleSection("advanced")}
                  >
                    <div className="space-y-4">
                      {/* Storage Overview */}
                      <div className="rounded-lg bg-white/40 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                            Total Storage
                          </span>
                          <span className="text-sm font-mono text-neutral-600 dark:text-neutral-400">
                            {storageInfo.isLoading ? "..." : formatBytes(storageInfo.totalSize)}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-500">
                          Browser Origin Private File System (OPFS)
                        </p>
                      </div>

                      {/* Backup */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
                          Backup
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            setIsExporting(true);
                            try {
                              await downloadFolderAsZip(
                                "/",
                                `wingman-backup-${new Date().toISOString().split("T")[0]}.zip`,
                              );
                            } catch (error) {
                              console.error("Export failed:", error);
                              notify.error("Couldn't export data", "Something went wrong. Please try again.");
                            } finally {
                              setIsExporting(false);
                            }
                          }}
                          disabled={isExporting}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-neutral-300/50 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Upload
                            size={16}
                            className={cn(
                              "text-neutral-500 dark:text-neutral-400 shrink-0",
                              isExporting && "animate-pulse",
                            )}
                          />
                          <div className="min-w-0">
                            <div className="font-medium">{isExporting ? "Exporting..." : "Export All Data"}</div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-500 truncate">
                              Download chats, agents, skills, and settings as ZIP
                            </div>
                          </div>
                        </button>
                      </div>

                      {/* Diagnostic Tools */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
                          Diagnostic Tools
                        </span>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setOpfsBrowserOpen(true)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-neutral-300/50 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 transition-colors text-left"
                          >
                            <HardDrive size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium">OPFS Browser</div>
                              <div className="text-xs text-neutral-500 dark:text-neutral-500 truncate">
                                Browse and inspect stored files
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={rebuildIndexes}
                            disabled={isRebuildingIndexes}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-neutral-300/50 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Settings
                              size={16}
                              className={cn(
                                "text-neutral-500 dark:text-neutral-400 shrink-0",
                                isRebuildingIndexes && "animate-spin",
                              )}
                            />
                            <div className="min-w-0">
                              <div className="font-medium">
                                {isRebuildingIndexes ? "Rebuilding..." : "Rebuild Indexes"}
                              </div>
                              <div className="text-xs text-neutral-500 dark:text-neutral-500 truncate">
                                Rescan and repair storage indexes
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Danger Zone */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-red-500/80 dark:text-red-400/80">
                          Danger Zone
                        </span>
                        <button
                          type="button"
                          onClick={deleteAllData}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100/50 dark:hover:bg-red-900/30 transition-colors text-left"
                        >
                          <Trash2 size={16} className="shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium">Delete All Data</div>
                            <div className="text-xs text-red-600/70 dark:text-red-400/70 truncate">
                              Permanently remove all chats, agents, and settings
                            </div>
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
