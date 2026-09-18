import { Dialog, Transition } from "@headlessui/react";
import {
  ArrowLeft,
  ChevronDown,
  Coffee,
  Download,
  HardDrive,
  Mic,
  Palette,
  Settings,
  Trash2,
  Upload,
  User,
  Wrench,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useChatActions, useChatList } from "@/features/chat/hooks/useChat";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { themeOptions } from "@/features/settings/lib/appearance";
import type { PersonaKey } from "@/features/settings/lib/personas";
import { personaOptions } from "@/features/settings/lib/personas";
import { rebuildAllIndexes } from "@/features/settings/lib/rebuildIndexes";
import { useToolsContext } from "@/features/tools";
import { COMPANION_ID } from "@/features/tools/hooks/useCompanion";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { clearAll, getStorageUsage } from "@/shared/lib/opfs";
import {
  downloadFolderAsZip,
  downloadFoldersAsZip,
  importFolderFromZip,
} from "@/shared/lib/opfs-zip";
import { formatBytes } from "@/shared/lib/utils";
import { ProviderState } from "@/shared/types/chat";
import type { BackgroundPack, EmojiMode, LayoutMode } from "@/shared/types/settings";
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

type SectionId = "general" | "audio" | "profile" | "backup" | "companion" | "advanced";

const SECTION_META: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "Appearance", icon: <Palette size={16} /> },
  { id: "audio", label: "Audio", icon: <Mic size={16} /> },
  { id: "profile", label: "Profile", icon: <User size={16} /> },
  { id: "backup", label: "Backup & Restore", icon: <HardDrive size={16} /> },
  { id: "companion", label: "Companion", icon: <Coffee size={16} /> },
  { id: "advanced", label: "Advanced", icon: <HardDrive size={16} /> },
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
  description,
  value,
  onChange,
  options,
}: {
  label: string;
  description?: React.ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <p className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
        {label}
      </p>
      {description && (
        <p className="mb-2.5 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
          {description}
        </p>
      )}
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex w-full gap-1 rounded-xl border border-neutral-200/70 bg-neutral-100/70 p-1 dark:border-neutral-700/60 dark:bg-neutral-800/60"
      >
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex-1 truncate rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 dark:focus-visible:ring-neutral-500/60",
                selected
                  ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5 dark:bg-neutral-700 dark:text-neutral-50 dark:ring-white/10"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsViewHeader({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-neutral-200/60 pb-4 dark:border-neutral-800/60">
      <h3 id={id} className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        {description}
      </p>
    </div>
  );
}

export function SettingsDrawer({
  isOpen,
  onClose,
  showAdvanced,
  initialSection,
}: SettingsDrawerProps) {
  const profileNameInputId = useId();
  const profileRoleInputId = useId();
  const profileAboutInputId = useId();
  const [section, setSection] = useState<SectionId>("general");
  const [mobileShowList, setMobileShowList] = useState(true);
  const { providers, getProviderState, companionEnabled, companionAvailable, toggleCompanion } =
    useToolsContext();
  const { agents, currentAgent, deleteAgent } = useAgents();
  const { plugins } = usePlugins();
  const companion = providers.find((p) => p.id === COMPANION_ID);
  const companionState = companion ? getProviderState(companion.id) : ProviderState.Disconnected;
  // The global enable flag only governs the companion outside agent mode. With an
  // agent active its config decides, so "enabled" for UI purposes is the live
  // connection state; the global toggle is shown as inactive.
  const companionConnected = currentAgent
    ? companionState === ProviderState.Connected
    : companionState === ProviderState.Connected && companionEnabled;
  const [opfsBrowserOpen, setOpfsBrowserOpen] = useState(false);
  const [isRebuildingIndexes, setIsRebuildingIndexes] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [backupSelectionOpen, setBackupSelectionOpen] = useState(false);
  const [backupSelection, setBackupSelection] = useState({
    chats: false,
    agents: false,
    profile: false,
    images: false,
    skills: false,
    plugins: false,
  });
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
  const { chats } = useChatList();
  const { deleteChat, stopStreaming } = useChatActions();
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
    }
  }, [isOpen, loadStorageInfo]);

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
        message:
          "This permanently removes every chat, agent, image, skill, and setting. It can't be undone.",
        danger: true,
      }))
    ) {
      return;
    }

    if (
      !(await confirm({
        title: "Are you absolutely sure?",
        message:
          "This is your final warning. All data will be permanently deleted and cannot be recovered.",
        danger: true,
        confirmLabel: "Delete everything",
      }))
    ) {
      return;
    }

    try {
      stopStreaming();
      await clearAll();
      window.location.reload();
    } catch (error) {
      console.error("Delete all failed:", error);
      notify.error("Couldn't delete all data", "Some data may remain. Reload before continuing.");
    }
  };

  const restoreBackup = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (
        !file ||
        !(await confirm({
          title: "Restore backup?",
          message:
            "Files from this backup will be merged with saved data. Matching files will be replaced; other files will be kept.",
        }))
      )
        return;
      setIsRestoring(true);
      setRestoreProgress(0);
      stopStreaming();
      try {
        await importFolderFromZip("/", file, setRestoreProgress);
        window.location.reload();
      } catch (error) {
        notify.error("Couldn't restore backup", error);
      } finally {
        setIsRestoring(false);
      }
    };
    input.click();
  };

  const rebuildIndexes = async () => {
    if (
      !(await confirm({
        title: "Rebuild indexes?",
        message: "This rescans chats, agents, images, and skills. It may take a moment.",
      }))
    ) {
      return;
    }

    try {
      setIsRebuildingIndexes(true);
      const result = await rebuildAllIndexes();
      notify.success(
        "Indexes rebuilt",
        `${result.chats} chats, ${result.agents} agents, ${result.images} images, ${result.skills} skills.`,
      );
      await loadStorageInfo();
    } catch (error) {
      console.error("Rebuild indexes failed:", error);
      notify.error("Couldn't rebuild indexes", "Check the console for details.");
    } finally {
      setIsRebuildingIndexes(false);
    }
  };

  const exportSelectedBackup = async () => {
    const folders = [
      ...(backupSelection.chats ? ["chats"] : []),
      ...(backupSelection.agents ? ["agents"] : []),
      ...(backupSelection.profile ? ["profile.json"] : []),
      ...(backupSelection.images ? ["images"] : []),
      ...(backupSelection.skills ? ["skills"] : []),
      ...(backupSelection.plugins ? ["plugins"] : []),
    ];
    if (!folders.length) return;

    setIsExporting(true);
    setExportProgress(0);
    try {
      await downloadFoldersAsZip(
        folders,
        `wingman-backup-${new Date().toISOString().split("T")[0]}.zip`,
        setExportProgress,
      );
    } catch (error) {
      console.error("Export failed:", error);
      notify.error("Couldn't export data", "Something went wrong. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const exportEverythingBackup = async () => {
    setIsExporting(true);
    setExportProgress(0);
    try {
      await downloadFolderAsZip(
        "/",
        `wingman-backup-${new Date().toISOString().split("T")[0]}.zip`,
        setExportProgress,
      );
    } catch (error) {
      console.error("Export failed:", error);
      notify.error("Couldn't export data", "Something went wrong. Please try again.");
    } finally {
      setIsExporting(false);
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
        await deleteAgent(agent.id);
      }
      notify.success("Agents deleted", "Reloading to apply changes…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      console.error("Failed to delete agents:", error);
      notify.error("Couldn't delete agents", "Something went wrong. Please try again.");
    }
  };

  const storageSizeFor = (prefix: string) =>
    storageInfo.entries
      .filter((entry) => entry.path.startsWith(prefix))
      .reduce((sum, entry) => sum + entry.size, 0);
  const chatStorageSize = storageSizeFor("chats/");
  const agentStorageSize = storageSizeFor("agents/");
  const imageStorageSize = storageSizeFor("images/");
  const skillStorageSize = storageSizeFor("skills/");
  const pluginStorageSize = storageSizeFor("plugins/");
  const imageCount = storageInfo.entries.filter(
    (entry) => entry.path.startsWith("images/") && entry.path.endsWith("/metadata.json"),
  ).length;
  const skillCount = storageInfo.entries.filter(
    (entry) => entry.path.startsWith("skills/") && entry.path.endsWith("/SKILL.md"),
  ).length;

  const backgroundOptions = [
    { value: null, label: "None" },
    ...backgroundPacks.map((p: BackgroundPack) => ({ value: p.name, label: p.name })),
  ];

  // Reset (or jump to initial) section when the modal opens
  useEffect(() => {
    if (isOpen) {
      setSection((initialSection as SectionId) ?? "general");
      setMobileShowList(!initialSection);
    }
  }, [isOpen, initialSection]);

  const openSection = useCallback((id: SectionId) => {
    setSection(id);
    setMobileShowList(false);
  }, []);

  const visibleSections = SECTION_META.filter((s) =>
    s.id === "companion" ? companionAvailable : s.id === "advanced" ? showAdvanced : true,
  );
  const activeMeta = visibleSections.find((s) => s.id === section) ?? visibleSections[0];

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-70" onClose={onClose}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="relative flex w-full flex-col overflow-hidden bg-white/95 shadow-xl backdrop-blur-xl dark:bg-neutral-900/95 rounded-t-2xl sm:rounded-xl sm:border sm:border-neutral-200/50 dark:sm:border-neutral-700/50 h-[92dvh] sm:h-[75dvh] sm:max-w-3xl">
                  {/* ── Top bar ── */}
                  <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200/60 px-3 sm:px-4 dark:border-neutral-800/60">
                    {!mobileShowList && (
                      <button
                        type="button"
                        onClick={() => setMobileShowList(true)}
                        title="Back to sections"
                        aria-label="Back to sections"
                        className="shrink-0 rounded-md p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 sm:hidden dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                      >
                        <ArrowLeft size={18} />
                      </button>
                    )}
                    <Dialog.Title className="shrink-0 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {activeMeta ? `Settings · ${activeMeta.label}` : "Settings"}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close settings"
                      className="ml-auto shrink-0 rounded-md p-2 sm:p-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  {/* ── Body ── */}
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    {/* ── Left nav sidebar ── */}
                    <nav
                      aria-label="Settings sections"
                      className={cn(
                        "w-full shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-neutral-200/60 bg-neutral-50/80 p-2 sm:flex sm:w-52 dark:border-neutral-800/60 dark:bg-neutral-950/20",
                        mobileShowList ? "flex" : "hidden",
                      )}
                    >
                      {visibleSections.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => openSection(s.id)}
                          aria-current={section === s.id ? "page" : undefined}
                          className={cn(
                            "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400",
                            section === s.id
                              ? "bg-neutral-200/50 text-neutral-900 dark:bg-neutral-800/60 dark:text-neutral-100"
                              : "text-neutral-600 hover:bg-neutral-200/40 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
                          )}
                        >
                          <span className="shrink-0 text-neutral-500 dark:text-neutral-400">
                            {s.icon}
                          </span>
                          {s.label}
                        </button>
                      ))}
                    </nav>

                    {/* ── Main panel ── */}
                    <div
                      className={cn(
                        "min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5",
                        mobileShowList ? "hidden sm:block" : "block",
                      )}
                    >
                      {/* General Section */}
                      {section === "general" && (
                        <section
                          aria-labelledby="appearance-settings-heading"
                          className="space-y-6"
                        >
                          <SettingsViewHeader
                            id="appearance-settings-heading"
                            title="Appearance"
                            description="Customize how Wingman looks and feels."
                          />

                          <div className="space-y-5">
                            <SegmentedControl
                              label="Theme"
                              value={theme}
                              onChange={setTheme}
                              options={themeOptions}
                            />
                            <SegmentedControl
                              label="Emoji"
                              description={
                                <>
                                  Choose minimal <span aria-hidden="true">✦ ☺</span> icons or native{" "}
                                  <span aria-hidden="true">😀 ✨</span> emoji.
                                </>
                              }
                              value={emojiMode}
                              onChange={setEmojiMode}
                              options={emojiOptions}
                            />
                          </div>
                          <SegmentedControl
                            label="Layout"
                            description="Wide gives chats more room; Normal keeps the content more focused."
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
                        </section>
                      )}

                      {/* Audio Section */}
                      {section === "audio" && (
                        <section aria-labelledby="audio-settings-heading" className="space-y-6">
                          <SettingsViewHeader
                            id="audio-settings-heading"
                            title="Audio"
                            description="Choose the microphone and speaker Wingman uses."
                          />

                          <div className="space-y-5">
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
                          </div>
                        </section>
                      )}

                      {/* Profile Section */}
                      {section === "profile" && (
                        <section aria-labelledby="profile-settings-heading" className="space-y-6">
                          <SettingsViewHeader
                            id="profile-settings-heading"
                            title="Profile"
                            description="Help Wingman tailor its responses to you."
                          />

                          <section aria-label="Assistant style">
                            <SelectMenu
                              label="Assistant style"
                              value={(profile.persona || "default") as PersonaKey}
                              onChange={(value) => updateProfile({ persona: value })}
                              options={personaOptions}
                              description={
                                personaOptions.find(
                                  (p) => p.value === (profile.persona || "default"),
                                )?.description
                              }
                            />
                          </section>

                          <section
                            aria-label="Personal details"
                            className="space-y-5 border-t border-neutral-200/60 pt-5 dark:border-neutral-800/60"
                          >
                            <div>
                              <label
                                htmlFor={profileNameInputId}
                                className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
                              >
                                Your name
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
                                className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
                              >
                                Your role
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
                                className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
                              >
                                About you
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
                          </section>
                        </section>
                      )}

                      {/* Backup & Restore Section */}
                      {section === "backup" && (
                        <section
                          aria-labelledby="backup-settings-heading"
                          className="flex flex-col gap-6"
                        >
                          <SettingsViewHeader
                            id="backup-settings-heading"
                            title="Backup & Restore"
                            description="Create copies of your data before making changes, or restore a previous backup."
                          />

                          <section aria-labelledby="full-backup-heading" className="space-y-3">
                            <h4
                              id="full-backup-heading"
                              className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                            >
                              Backup
                            </h4>
                            <div className="space-y-3">
                              <button
                                type="button"
                                onClick={() => void exportEverythingBackup()}
                                disabled={isExporting || isRestoring}
                                className="relative w-full flex items-center justify-center gap-2 overflow-hidden rounded-lg border border-neutral-300/50 bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700/50 dark:bg-neutral-800/50 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
                              >
                                {isExporting && (
                                  <span
                                    aria-hidden="true"
                                    className="absolute inset-y-0 left-0 bg-blue-500/15 transition-[width] duration-200 dark:bg-blue-400/20"
                                    style={{ width: `${Math.round(exportProgress * 100)}%` }}
                                  />
                                )}
                                <span className="relative flex items-center justify-center gap-2">
                                  <Download
                                    size={16}
                                    className={isExporting ? "animate-pulse" : undefined}
                                  />
                                  {isExporting
                                    ? `Creating backup... ${Math.round(exportProgress * 100)}%`
                                    : "Back up everything"}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setBackupSelectionOpen((open) => !open)}
                                aria-expanded={backupSelectionOpen}
                                className="flex w-full items-center justify-between px-1 py-1 text-left text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
                              >
                                Choose items instead
                                <ChevronDown
                                  size={15}
                                  className={cn(
                                    "transition-transform",
                                    backupSelectionOpen && "rotate-180",
                                  )}
                                />
                              </button>
                              {backupSelectionOpen && (
                                <>
                                  <div className="divide-y divide-neutral-200/60 overflow-hidden rounded-lg border border-neutral-200/60 dark:divide-neutral-700/60 dark:border-neutral-700/60">
                                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 dark:hover:bg-neutral-800/30">
                                      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                        Profile
                                      </span>
                                      <span className="ml-auto w-16 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                                        {storageInfo.isLoading
                                          ? "Loading size..."
                                          : formatBytes(
                                              storageInfo.entries.find(
                                                (entry) => entry.path === "profile.json",
                                              )?.size ?? 0,
                                            )}
                                      </span>
                                      <input
                                        type="checkbox"
                                        checked={backupSelection.profile}
                                        onChange={(event) =>
                                          setBackupSelection((selection) => ({
                                            ...selection,
                                            profile: event.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-neutral-800"
                                      />
                                    </label>
                                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 dark:hover:bg-neutral-800/30">
                                      <span className="flex items-baseline gap-2">
                                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                          Chats
                                        </span>
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                          {chats.length} chat{chats.length === 1 ? "" : "s"}
                                        </span>
                                      </span>
                                      <span className="ml-auto w-16 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                                        {storageInfo.isLoading
                                          ? "..."
                                          : formatBytes(chatStorageSize)}
                                      </span>
                                      <input
                                        type="checkbox"
                                        checked={backupSelection.chats}
                                        disabled={chats.length === 0}
                                        onChange={(event) =>
                                          setBackupSelection((selection) => ({
                                            ...selection,
                                            chats: event.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-neutral-800"
                                      />
                                    </label>
                                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 dark:hover:bg-neutral-800/30">
                                      <span className="flex items-baseline gap-2">
                                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                          Agents
                                        </span>
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                          {agents.length} agent{agents.length === 1 ? "" : "s"}
                                        </span>
                                      </span>
                                      <span className="ml-auto w-16 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                                        {storageInfo.isLoading
                                          ? "..."
                                          : formatBytes(agentStorageSize)}
                                      </span>
                                      <input
                                        type="checkbox"
                                        checked={backupSelection.agents}
                                        disabled={agents.length === 0}
                                        onChange={(event) =>
                                          setBackupSelection((selection) => ({
                                            ...selection,
                                            agents: event.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-neutral-800"
                                      />
                                    </label>
                                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 dark:hover:bg-neutral-800/30">
                                      <span className="flex items-baseline gap-2">
                                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                          Images
                                        </span>
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                          {imageCount} image{imageCount === 1 ? "" : "s"}
                                        </span>
                                      </span>
                                      <span className="ml-auto w-16 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                                        {storageInfo.isLoading
                                          ? "..."
                                          : formatBytes(imageStorageSize)}
                                      </span>
                                      <input
                                        type="checkbox"
                                        checked={backupSelection.images}
                                        onChange={(event) =>
                                          setBackupSelection((selection) => ({
                                            ...selection,
                                            images: event.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-neutral-800"
                                      />
                                    </label>
                                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 dark:hover:bg-neutral-800/30">
                                      <span className="flex items-baseline gap-2">
                                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                          Skills
                                        </span>
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                          {skillCount} skill{skillCount === 1 ? "" : "s"}
                                        </span>
                                      </span>
                                      <span className="ml-auto w-16 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                                        {storageInfo.isLoading
                                          ? "..."
                                          : formatBytes(skillStorageSize)}
                                      </span>
                                      <input
                                        type="checkbox"
                                        checked={backupSelection.skills}
                                        onChange={(event) =>
                                          setBackupSelection((selection) => ({
                                            ...selection,
                                            skills: event.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-neutral-800"
                                      />
                                    </label>
                                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 dark:hover:bg-neutral-800/30">
                                      <span className="flex items-baseline gap-2">
                                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                          Plugins
                                        </span>
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                          {plugins.length} plugin{plugins.length === 1 ? "" : "s"}
                                        </span>
                                      </span>
                                      <span className="ml-auto w-16 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                                        {storageInfo.isLoading
                                          ? "..."
                                          : formatBytes(pluginStorageSize)}
                                      </span>
                                      <input
                                        type="checkbox"
                                        checked={backupSelection.plugins}
                                        onChange={(event) =>
                                          setBackupSelection((selection) => ({
                                            ...selection,
                                            plugins: event.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-neutral-800"
                                      />
                                    </label>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void exportSelectedBackup()}
                                    disabled={
                                      isExporting ||
                                      isRestoring ||
                                      (!backupSelection.chats &&
                                        !backupSelection.agents &&
                                        !backupSelection.profile &&
                                        !backupSelection.images &&
                                        !backupSelection.skills &&
                                        !backupSelection.plugins)
                                    }
                                    className="relative mt-2 w-full flex items-center justify-center gap-2 overflow-hidden rounded-lg border border-neutral-300/50 bg-white/50 px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700/50 dark:bg-neutral-800/50 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
                                  >
                                    {isExporting && (
                                      <span
                                        aria-hidden="true"
                                        className="absolute inset-y-0 left-0 bg-blue-500/15 transition-[width] duration-200 dark:bg-blue-400/20"
                                        style={{ width: `${Math.round(exportProgress * 100)}%` }}
                                      />
                                    )}
                                    <span className="relative flex items-center justify-center gap-2">
                                      <Download
                                        size={16}
                                        className={isExporting ? "animate-pulse" : undefined}
                                      />
                                      {isExporting
                                        ? `Creating backup... ${Math.round(exportProgress * 100)}%`
                                        : "Back up selected"}
                                    </span>
                                  </button>
                                </>
                              )}
                            </div>
                          </section>

                          <section
                            aria-labelledby="restore-backup-heading"
                            className="space-y-3 border-t border-neutral-200/60 pt-5 dark:border-neutral-800/60"
                          >
                            <div>
                              <h4
                                id="restore-backup-heading"
                                className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                              >
                                Restore
                              </h4>
                              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                                Merge data from a full or partial backup ZIP.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={restoreBackup}
                              disabled={isExporting || isRestoring}
                              className="relative w-full flex items-center justify-center gap-2 overflow-hidden rounded-lg border border-neutral-300/50 bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700/50 dark:bg-neutral-800/50 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
                            >
                              {isRestoring && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 bg-blue-500/15 transition-[width] duration-200 dark:bg-blue-400/20"
                                  style={{ width: `${Math.round(restoreProgress * 100)}%` }}
                                />
                              )}
                              <span className="relative flex items-center justify-center gap-2">
                                <Upload
                                  size={16}
                                  className="text-neutral-500 dark:text-neutral-400 shrink-0"
                                />
                                <span className="font-medium">
                                  {isRestoring
                                    ? `Restoring... ${Math.round(restoreProgress * 100)}%`
                                    : "Restore backup"}
                                </span>
                              </span>
                            </button>
                          </section>

                          <section
                            aria-labelledby="backup-danger-heading"
                            className="space-y-3 border-t border-red-200/70 pt-5 dark:border-red-900/40"
                          >
                            <div>
                              <h4
                                id="backup-danger-heading"
                                className="text-sm font-medium text-red-700 dark:text-red-400"
                              >
                                Danger zone
                              </h4>
                              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                                These actions permanently remove local data and cannot be undone.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={deleteChats}
                                disabled={chats.length === 0}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                              >
                                <Trash2 size={14} />
                                Delete all chats
                              </button>
                              <button
                                type="button"
                                onClick={deleteAgents}
                                disabled={agents.length === 0}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                              >
                                <Trash2 size={14} />
                                Delete all agents
                              </button>
                            </div>
                          </section>
                        </section>
                      )}

                      {/* Companion Section */}
                      {section === "companion" && companionAvailable && (
                        <section aria-labelledby="companion-settings-heading" className="space-y-6">
                          <SettingsViewHeader
                            id="companion-settings-heading"
                            title="Companion"
                            description="Manage the companion connection and the tools it provides."
                          />

                          <section
                            aria-labelledby="companion-connection-heading"
                            className="space-y-5"
                          >
                            <div className="flex items-center justify-between">
                              <h4
                                id="companion-connection-heading"
                                className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                              >
                                Connection
                              </h4>
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                                  Enable companion
                                </span>
                                <button
                                  type="button"
                                  onClick={toggleCompanion}
                                  disabled={!!currentAgent}
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
                                    companionEnabled
                                      ? "bg-emerald-500 dark:bg-emerald-600"
                                      : "bg-neutral-300 dark:bg-neutral-600"
                                  }`}
                                  role="switch"
                                  aria-checked={companionEnabled}
                                  aria-label="Enable companion"
                                >
                                  <span
                                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                                      companionEnabled ? "translate-x-4.5" : "translate-x-0.5"
                                    }`}
                                  />
                                </button>
                              </div>
                            </div>

                            {currentAgent ? (
                              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                                While an agent is active, the companion is controlled by the agent's
                                tools, not this global setting.
                              </p>
                            ) : null}

                            {companionConnected && companion && companion.tools.length > 0 ? (
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                                  {companion.tools.length} tool
                                  {companion.tools.length !== 1 ? "s" : ""} available
                                </p>
                                <div className="space-y-1">
                                  {companion.tools.map((tool) => (
                                    <div key={tool.name} className="flex items-center gap-2 py-1.5">
                                      <span className="shrink-0 text-neutral-600 dark:text-neutral-400">
                                        {(() => {
                                          const toolIcon =
                                            tool.icon ??
                                            (typeof companion.icon === "string"
                                              ? companion.icon
                                              : undefined);
                                          if (toolIcon) {
                                            return (
                                              <McpProviderIcon
                                                src={toolIcon}
                                                size={16}
                                                className="object-contain"
                                              />
                                            );
                                          }
                                          if (
                                            companion.icon &&
                                            typeof companion.icon !== "string"
                                          ) {
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
                              <p className="text-sm text-neutral-400 dark:text-neutral-500">
                                No tools exposed
                              </p>
                            ) : (
                              <p className="text-sm text-neutral-400 dark:text-neutral-500">
                                Enable the companion to see available tools.
                              </p>
                            )}
                          </section>
                        </section>
                      )}

                      {/* Advanced — only visible via Alt+click */}
                      {section === "advanced" && showAdvanced && (
                        <section aria-labelledby="advanced-settings-heading" className="space-y-6">
                          <SettingsViewHeader
                            id="advanced-settings-heading"
                            title="Advanced"
                            description="Inspect storage, run maintenance tools, or permanently remove local data."
                          />

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
                                <HardDrive
                                  size={16}
                                  className="text-neutral-500 dark:text-neutral-400 shrink-0"
                                />
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
                        </section>
                      )}
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
      <OpfsBrowser isOpen={opfsBrowserOpen} onClose={() => setOpfsBrowserOpen(false)} />
    </>
  );
}
