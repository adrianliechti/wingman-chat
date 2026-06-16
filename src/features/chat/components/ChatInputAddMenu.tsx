import { flip, offset, shift, useFloating } from "@floating-ui/react-dom";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@headlessui/react";
import {
  Bot,
  Check,
  ChevronRight,
  FolderCog,
  HardDrive,
  Library,
  LoaderCircle,
  Mic,
  Paperclip,
  PenTool,
  Plus,
  ScreenShare,
  Settings2,
  Sparkles,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentWizard } from "@/features/agent/components/wizard/AgentWizard";
import { useAgentFiles } from "@/features/agent/hooks/useAgentFiles";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { SKILL_BUILDER_ID } from "@/features/skills/hooks/useSkillBuilderProvider";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { useSkillTemplates } from "@/features/skills/hooks/useSkillTemplates";
import { NOTEBOOK_PROVIDER_ID } from "@/features/notebook/hooks/useNotebookGuideProvider";
import { isNotebookSkillCategory, SKILLS_PROVIDER_ID, type SkillSources } from "@/features/skills/lib/skillsProvider";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import type { ToolProvider } from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface ChatInputAddMenuProps {
  isScreenCaptureAvailable: boolean;
  isContinuousCaptureActive: boolean;
  canTranscribe: boolean;
  isTranscribing: boolean;
  isResponding: boolean;
  visibleProviders: ToolProvider[];
  getProviderState: (id: string) => ProviderState;
  setProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
  skillSources: SkillSources;
  setSkillSources: (sources: SkillSources) => void;
  onAttachmentClick: () => void;
  onContinuousCaptureToggle: () => Promise<void>;
  onTranscriptionClick: () => Promise<void>;
  onDriveSelect: (drive: ReturnType<typeof getConfig>["drives"][number]) => void;
}

export function ChatInputAddMenu({
  isScreenCaptureAvailable,
  isContinuousCaptureActive,
  canTranscribe,
  isTranscribing,
  isResponding,
  visibleProviders,
  getProviderState,
  setProviderEnabled,
  skillSources,
  setSkillSources,
  onAttachmentClick,
  onContinuousCaptureToggle,
  onTranscriptionClick,
  onDriveSelect,
}: ChatInputAddMenuProps) {
  const config = getConfig();
  const { agents, currentAgent, setCurrentAgent, setShowAgentDrawer, setAgentDrawerView } = useAgents();
  const { skills, openSkillCatalog } = useSkills();
  const { templates } = useSkillTemplates();
  // The Notebook generation pack is split out of the general catalog by category.
  const notebookTemplateCount = templates.filter((t) => isNotebookSkillCategory(t.category)).length;
  const catalogTemplateCount = templates.length - notebookTemplateCount;

  // The Skills tool and Skill Builder are grouped into the "Skills" submenu, so
  // they're filtered out of the flat tool list below.
  const otherProviders = visibleProviders.filter((p) => p.id !== SKILLS_PROVIDER_ID && p.id !== SKILL_BUILDER_ID);
  const skillBuilder = visibleProviders.find((p) => p.id === SKILL_BUILDER_ID);
  // Skills submenu shows whenever no agent is active — My Skills / Catalog / Manage
  // are always meaningful; the Skill Builder row is rendered only if available.
  const showSkillsMenu = !currentAgent;

  // The Skills sources toggle independently (personal + catalog + notebook).
  const toggleSkillSource = useCallback(
    (key: "personal" | "catalog" | "notebook") => {
      setSkillSources({ ...skillSources, [key]: !skillSources[key] });
    },
    [skillSources, setSkillSources],
  );

  // Toggle a top-level tool provider. The Notebook tool pairs its injected
  // system prompt with its skill set, so flip `skillSources.notebook` too.
  const toggleProvider = useCallback(
    async (id: string, enabled: boolean) => {
      await setProviderEnabled(id, enabled);
      if (id === NOTEBOOK_PROVIDER_ID) setSkillSources({ ...skillSources, notebook: enabled });
    },
    [setProviderEnabled, setSkillSources, skillSources],
  );

  const [showMobileSheet, setShowMobileSheet] = useState(false);

  // Submenus — only one can be active at a time
  const [activeSubmenu, setActiveSubmenu] = useState<"file" | "agent" | "skills" | null>(null);
  const submenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSubmenu = useCallback((name: "file" | "agent" | "skills") => {
    if (submenuTimer.current) clearTimeout(submenuTimer.current);
    setActiveSubmenu(name);
  }, []);

  const scheduleCloseSubmenu = useCallback(() => {
    submenuTimer.current = setTimeout(() => setActiveSubmenu(null), 150);
  }, []);

  useEffect(() => {
    return () => {
      if (submenuTimer.current) clearTimeout(submenuTimer.current);
    };
  }, []);

  const { refs: fileRefs, floatingStyles: fileFloatingStyles } = useFloating({
    placement: "right-start",
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ["right-end", "left-start", "left-end"] }),
      shift({ padding: 8 }),
    ],
  });

  const { refs: agentRefs, floatingStyles: agentFloatingStyles } = useFloating({
    placement: "right-start",
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ["right-end", "left-start", "left-end"] }),
      shift({ padding: 8 }),
    ],
  });

  const { refs: skillsRefs, floatingStyles: skillsFloatingStyles } = useFloating({
    placement: "right-start",
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ["right-end", "left-start", "left-end"] }),
      shift({ padding: 8 }),
    ],
  });

  // Agent wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pendingWizardFiles, setPendingWizardFiles] = useState<File[] | null>(null);
  const { addFile } = useAgentFiles(currentAgent?.id ?? "");

  useEffect(() => {
    if (!currentAgent || !pendingWizardFiles) return;
    setPendingWizardFiles(null);
    void (async () => {
      for (const file of pendingWizardFiles) {
        await addFile(file);
      }
    })();
  }, [currentAgent, addFile, pendingWizardFiles]);

  const handleWizardCreated = useCallback((_agent: Agent, files: File[]) => {
    if (files.length > 0) setPendingWizardFiles(files);
  }, []);

  function renderProviderIcon(provider: ToolProvider, state: ProviderState) {
    const icon = provider.icon || Sparkles;
    const providerInitializing = state === ProviderState.Initializing;
    const providerFailed = state === ProviderState.Failed;

    if (providerInitializing) return <LoaderCircle size={16} className="animate-spin" />;
    if (providerFailed) return <TriangleAlert size={16} />;
    if (typeof icon === "string") return <McpProviderIcon src={icon} size={16} className="shrink-0 object-contain" />;
    const Icon = icon;
    return <Icon size={16} />;
  }

  return (
    <>
      {/* Mobile: Plus button opens bottom sheet */}
      <button
        type="button"
        className="md:hidden pl-1.5 pr-0.5 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
        title="More options"
        onClick={() => setShowMobileSheet(true)}
      >
        <Plus size={16} />
      </button>

      {/* Desktop: Add menu (screen share, file upload, drives, features) */}
      <div className="hidden md:contents">
        <Menu>
          <Tooltip content="Add files, tools and more" side="bottom">
            <MenuButton
              className="p-2.5 md:pl-1.5 md:pr-0.5 md:py-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              aria-label="Add"
            >
              <Plus size={16} />
            </MenuButton>
          </Tooltip>
          <MenuItems
            modal={false}
            transition
            anchor="top start"
            className="max-h-[60vh]! mb-2 rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1 overflow-y-auto z-50 min-w-40 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
          >
            {isScreenCaptureAvailable && (
              <MenuItem>
                {({ close }) => (
                  <Tooltip
                    content={
                      isContinuousCaptureActive
                        ? "Stop sharing — removes the live screen feed from the conversation"
                        : "Share your screen continuously as context for the conversation"
                    }
                    side="right"
                    className="w-full"
                  >
                    <button
                      type="button"
                      onClick={async () => {
                        close();
                        await onContinuousCaptureToggle();
                      }}
                      className={cn(
                        "group flex w-full items-center gap-3 px-3 py-2 rounded-lg data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/60 dark:hover:bg-white/5 transition-colors",
                        isContinuousCaptureActive
                          ? "text-green-600 dark:text-green-400"
                          : "text-neutral-800 dark:text-neutral-200",
                      )}
                    >
                      <ScreenShare size={16} className="shrink-0" />
                      <span className="font-medium text-sm">
                        {isContinuousCaptureActive ? "Stop Screen Capture" : "Share Screen"}
                      </span>
                    </button>
                  </Tooltip>
                )}
              </MenuItem>
            )}
            <MenuItem>
              <button
                ref={fileRefs.setReference}
                type="button"
                onClick={() => (config.drives.length === 0 ? onAttachmentClick() : undefined)}
                onMouseEnter={() => {
                  if (config.drives.length === 0) return;
                  openSubmenu("file");
                }}
                onMouseLeave={scheduleCloseSubmenu}
                className="group flex w-full items-center gap-3 px-3 py-2 rounded-lg data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
              >
                <Paperclip size={16} className="shrink-0" />
                <span className="font-medium text-sm flex-1 text-left">Add File</span>
                {config.drives.length > 0 && <ChevronRight size={14} className="shrink-0 text-neutral-400" />}
              </button>
            </MenuItem>
            {activeSubmenu === "file" &&
              createPortal(
                <div
                  ref={fileRefs.setFloating}
                  data-file-submenu
                  role="none"
                  style={fileFloatingStyles}
                  className="z-9999"
                  onMouseEnter={() => openSubmenu("file")}
                  onMouseLeave={scheduleCloseSubmenu}
                >
                  <div className="rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1 min-w-40">
                    <button
                      type="button"
                      onClick={onAttachmentClick}
                      className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <Paperclip size={16} className="shrink-0" />
                      <span className="font-medium text-sm">Upload</span>
                    </button>
                    {config.drives.map((fp) => (
                      <button
                        key={fp.id}
                        type="button"
                        onClick={() => {
                          setActiveSubmenu(null);
                          onDriveSelect(fp);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                      >
                        {fp.icon ? (
                          <span
                            className="shrink-0 bg-current inline-block"
                            style={{
                              width: 16,
                              height: 16,
                              maskImage: `url(${fp.icon})`,
                              WebkitMaskImage: `url(${fp.icon})`,
                              maskSize: "contain",
                              maskRepeat: "no-repeat",
                              maskPosition: "center",
                            }}
                          />
                        ) : (
                          <HardDrive size={16} />
                        )}
                        <span className="font-medium text-sm">{fp.name}</span>
                      </button>
                    ))}
                  </div>
                </div>,
                document.body,
              )}
            {showSkillsMenu && (
              <MenuItem>
                <button
                  ref={skillsRefs.setReference}
                  type="button"
                  onMouseEnter={() => openSubmenu("skills")}
                  onMouseLeave={scheduleCloseSubmenu}
                  className="group flex w-full items-center gap-3 px-3 py-2 rounded-lg data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                >
                  <Sparkles size={16} className="shrink-0" />
                  <span className="font-medium text-sm flex-1 text-left">Skills</span>
                  <ChevronRight size={14} className="shrink-0 text-neutral-400" />
                </button>
              </MenuItem>
            )}
            <MenuItem>
              <button
                ref={agentRefs.setReference}
                type="button"
                onMouseEnter={() => openSubmenu("agent")}
                onMouseLeave={scheduleCloseSubmenu}
                className="group flex w-full items-center gap-3 px-3 py-2 rounded-lg data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
              >
                <Bot size={16} className="shrink-0" />
                <span className="font-medium text-sm flex-1 text-left">Agents</span>
                <ChevronRight size={14} className="shrink-0 text-neutral-400" />
              </button>
            </MenuItem>
            {activeSubmenu === "agent" &&
              createPortal(
                <div
                  ref={agentRefs.setFloating}
                  data-agent-submenu
                  role="none"
                  style={agentFloatingStyles}
                  className="z-9999"
                  onMouseEnter={() => openSubmenu("agent")}
                  onMouseLeave={scheduleCloseSubmenu}
                >
                  <div className="rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1 min-w-48 flex flex-col overflow-hidden max-h-[min(60vh,400px)]">
                    {agents.length === 0 && (
                      <p className="px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400">No agents configured</p>
                    )}
                    <div className="overflow-y-auto">
                      {agents.map((agent) => (
                        <div
                          key={agent.id}
                          className="group/agent flex w-full items-center rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentAgent(agent);
                              setActiveSubmenu(null);
                              setAgentDrawerView("details");
                              setShowAgentDrawer(true);
                            }}
                            className="flex flex-1 min-w-0 items-center gap-3 px-3 py-2"
                          >
                            <Bot size={16} className="shrink-0" />
                            <span className="font-medium text-sm flex-1 text-left truncate">{agent.name}</span>
                            {currentAgent?.id === agent.id && (
                              <Check size={13} className="shrink-0 ml-1 text-neutral-600 dark:text-neutral-400" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-neutral-200 dark:border-neutral-700 mt-1" />
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSubmenu(null);
                        setWizardOpen(true);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <Plus size={16} className="shrink-0" />
                      <span className="font-medium text-sm">Add Agent</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSubmenu(null);
                        setAgentDrawerView("list");
                        setShowAgentDrawer(true);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <FolderCog size={16} className="shrink-0" />
                      <span className="font-medium text-sm">Manage Agents</span>
                    </button>
                  </div>
                </div>,
                document.body,
              )}
            {activeSubmenu === "skills" &&
              createPortal(
                <div
                  ref={skillsRefs.setFloating}
                  data-skills-submenu
                  role="none"
                  style={skillsFloatingStyles}
                  className="z-9999"
                  onMouseEnter={() => openSubmenu("skills")}
                  onMouseLeave={scheduleCloseSubmenu}
                >
                  <div className="rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1 min-w-48 flex flex-col overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSkillSource("personal")}
                      className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <User size={16} className="shrink-0" />
                      <span className="font-medium text-sm flex-1 text-left">
                        My Skills <span className="text-neutral-400 dark:text-neutral-500">({skills.length})</span>
                      </span>
                      <span className="shrink-0 w-4 flex justify-center">
                        {skillSources.personal && (
                          <Check size={13} className="text-neutral-600 dark:text-neutral-400" />
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSkillSource("catalog")}
                      className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <Library size={16} className="shrink-0" />
                      <span className="font-medium text-sm flex-1 text-left">
                        Catalog{" "}
                        <span className="text-neutral-400 dark:text-neutral-500">({catalogTemplateCount})</span>
                      </span>
                      <span className="shrink-0 w-4 flex justify-center">
                        {skillSources.catalog && <Check size={13} className="text-neutral-600 dark:text-neutral-400" />}
                      </span>
                    </button>
                    {skillBuilder && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await setProviderEnabled(
                              SKILL_BUILDER_ID,
                              getProviderState(SKILL_BUILDER_ID) !== ProviderState.Connected,
                            );
                          } catch (error) {
                            console.error("Failed to toggle Skill Builder:", error);
                          }
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                      >
                        <PenTool size={16} className="shrink-0" />
                        <span className="font-medium text-sm flex-1 text-left">Skill Builder</span>
                        <span className="shrink-0 w-4 flex justify-center">
                          {getProviderState(SKILL_BUILDER_ID) === ProviderState.Connected && (
                            <Check size={13} className="text-neutral-600 dark:text-neutral-400" />
                          )}
                        </span>
                      </button>
                    )}
                    <div className="border-t border-neutral-200 dark:border-neutral-700 mt-1" />
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSubmenu(null);
                        openSkillCatalog();
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <FolderCog size={16} className="shrink-0" />
                      <span className="font-medium text-sm">Manage Skills</span>
                    </button>
                  </div>
                </div>,
                document.body,
              )}
            {otherProviders.length > 0 && <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />}
            {otherProviders.map((provider: ToolProvider) => {
              const state = getProviderState(provider.id);
              const providerEnabled = state === ProviderState.Connected;
              const providerInitializing = state === ProviderState.Initializing;
              const providerFailed = state === ProviderState.Failed;

              return (
                <MenuItem key={provider.id}>
                  <Tooltip
                    content={
                      providerFailed
                        ? `${provider.name} failed to connect`
                        : providerInitializing
                          ? `${provider.name} is connecting…`
                          : (provider.description ??
                            (providerEnabled
                              ? `Disable ${provider.name} tools for this conversation`
                              : `Enable ${provider.name} tools for this conversation`))
                    }
                    side="right"
                    className="w-full"
                  >
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        if (providerInitializing) return;
                        try {
                          await toggleProvider(provider.id, !providerEnabled);
                        } catch (error) {
                          console.error(`Failed to toggle provider ${provider.name}:`, error);
                        }
                      }}
                      disabled={providerInitializing}
                      className="group flex w-full items-center gap-3 px-3 py-2 rounded-lg data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors disabled:opacity-50"
                    >
                      {renderProviderIcon(provider, state)}
                      <span className="font-medium text-sm flex-1 text-left truncate">{provider.name}</span>
                      <span className="shrink-0 w-4 flex justify-center">
                        {providerEnabled && !providerInitializing && !providerFailed && (
                          <Check size={13} className="ml-1 text-neutral-600 dark:text-neutral-400" />
                        )}
                      </span>
                    </button>
                  </Tooltip>
                </MenuItem>
              );
            })}
          </MenuItems>
        </Menu>
      </div>

      <AgentWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={handleWizardCreated} />

      {/* Mobile bottom sheet — attach, screen capture, recording, and features */}
      <Dialog open={showMobileSheet} onClose={setShowMobileSheet} className="relative z-50 md:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/40 dark:bg-black/60 duration-200 ease-out data-closed:opacity-0"
        />
        <div className="fixed inset-x-0 bottom-0">
          <DialogPanel
            transition
            className="w-full max-h-[75dvh] flex flex-col rounded-t-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-2xl border-t border-x border-neutral-200/50 dark:border-neutral-700/50 pb-[env(safe-area-inset-bottom)] duration-300 ease-out data-closed:translate-y-full"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-end px-4 py-1 border-b border-neutral-200/60 dark:border-neutral-800/60 shrink-0">
              <DialogTitle className="sr-only">More Options</DialogTitle>
              <button
                type="button"
                onClick={() => setShowMobileSheet(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1">
              {/* Action cards */}
              <div className="px-3 pt-2 pb-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onAttachmentClick();
                    setShowMobileSheet(false);
                  }}
                  className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 transition-colors active:scale-95"
                >
                  <Paperclip size={20} />
                  <span className="text-xs font-medium leading-tight text-center">Upload File</span>
                </button>

                {config.drives.map((fp) => (
                  <button
                    key={fp.id}
                    type="button"
                    onClick={() => {
                      onDriveSelect(fp);
                      setShowMobileSheet(false);
                    }}
                    className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 transition-colors active:scale-95"
                  >
                    {fp.icon ? (
                      <span
                        className="bg-current inline-block"
                        style={{
                          width: 20,
                          height: 20,
                          maskImage: `url(${fp.icon})`,
                          WebkitMaskImage: `url(${fp.icon})`,
                          maskSize: "contain",
                          maskRepeat: "no-repeat",
                          maskPosition: "center",
                        }}
                      />
                    ) : (
                      <HardDrive size={20} />
                    )}
                    <span className="text-xs font-medium leading-tight text-center">{fp.name}</span>
                  </button>
                ))}

                {isScreenCaptureAvailable && (
                  <button
                    type="button"
                    onClick={() => {
                      void onContinuousCaptureToggle();
                      setShowMobileSheet(false);
                    }}
                    className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl transition-colors active:scale-95 ${
                      isContinuousCaptureActive
                        ? "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400"
                        : "bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200"
                    }`}
                  >
                    <ScreenShare size={20} />
                    <span className="text-xs font-medium leading-tight text-center">
                      {isContinuousCaptureActive ? "Stop Capture" : "Screen Capture"}
                    </span>
                  </button>
                )}

                {canTranscribe && !isTranscribing && (
                  <button
                    type="button"
                    onClick={() => {
                      void onTranscriptionClick();
                      setShowMobileSheet(false);
                    }}
                    disabled={isResponding}
                    className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 transition-colors active:scale-95 disabled:opacity-50"
                  >
                    <Mic size={20} />
                    <span className="text-xs font-medium leading-tight text-center">Start Recording</span>
                  </button>
                )}
              </div>

              {/* Features section */}
              {otherProviders.length > 0 && (
                <>
                  <div className="mx-3 mb-2 border-t border-neutral-200/60 dark:border-neutral-800/60" />
                  <div className="px-4 pb-1">
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Tools
                    </p>
                  </div>
                  <div className="px-2">
                    {otherProviders.map((provider: ToolProvider) => {
                      const state = getProviderState(provider.id);
                      const providerEnabled = state === ProviderState.Connected;
                      const providerInitializing = state === ProviderState.Initializing;
                      const providerFailed = state === ProviderState.Failed;

                      return (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (providerInitializing) return;
                            try {
                              await toggleProvider(provider.id, !providerEnabled);
                            } catch (error) {
                              console.error(`Failed to toggle provider ${provider.name}:`, error);
                            }
                          }}
                          disabled={providerInitializing}
                          className={`flex w-full items-center gap-3 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50 ${
                            providerEnabled
                              ? "text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800"
                              : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-white/5"
                          }`}
                        >
                          {renderProviderIcon(provider, state)}
                          <div className="flex flex-col items-start flex-1 min-w-0 text-left">
                            <span className="font-medium text-sm">{provider.name}</span>
                            {provider.description && (
                              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate w-full">
                                {provider.description}
                              </span>
                            )}
                          </div>
                          {providerEnabled && !providerInitializing && !providerFailed && (
                            <Check size={16} className="shrink-0 text-neutral-600 dark:text-neutral-400" />
                          )}
                          {providerFailed && <TriangleAlert size={16} className="shrink-0 text-neutral-400" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Skills section */}
              {showSkillsMenu && (
                <>
                  <div className="mx-3 mb-2 border-t border-neutral-200/60 dark:border-neutral-800/60" />
                  <div className="px-4 pb-1 flex items-center justify-between">
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Skills
                    </p>
                    <button
                      type="button"
                      title="Manage Skills"
                      onClick={() => {
                        setShowMobileSheet(false);
                        openSkillCatalog();
                      }}
                      className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition-colors"
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                  <div className="px-2 pb-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSkillSource("personal");
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-1.5 rounded-xl transition-colors ${
                        skillSources.personal
                          ? "text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800"
                          : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-white/5"
                      }`}
                    >
                      <User size={16} className="shrink-0" />
                      <span className="font-medium text-sm flex-1 text-left">
                        My Skills <span className="text-neutral-400 dark:text-neutral-500">({skills.length})</span>
                      </span>
                      {skillSources.personal && (
                        <Check size={16} className="shrink-0 text-neutral-600 dark:text-neutral-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSkillSource("catalog");
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-1.5 rounded-xl transition-colors ${
                        skillSources.catalog
                          ? "text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800"
                          : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-white/5"
                      }`}
                    >
                      <Library size={16} className="shrink-0" />
                      <span className="font-medium text-sm flex-1 text-left">
                        Catalog <span className="text-neutral-400 dark:text-neutral-500">({catalogTemplateCount})</span>
                      </span>
                      {skillSources.catalog && (
                        <Check size={16} className="shrink-0 text-neutral-600 dark:text-neutral-400" />
                      )}
                    </button>
                    {skillBuilder && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await setProviderEnabled(
                              SKILL_BUILDER_ID,
                              getProviderState(SKILL_BUILDER_ID) !== ProviderState.Connected,
                            );
                          } catch (error) {
                            console.error("Failed to toggle Skill Builder:", error);
                          }
                        }}
                        className={`flex w-full items-center gap-3 px-3 py-1.5 rounded-xl transition-colors ${
                          getProviderState(SKILL_BUILDER_ID) === ProviderState.Connected
                            ? "text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800"
                            : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-white/5"
                        }`}
                      >
                        <PenTool size={16} className="shrink-0" />
                        <span className="font-medium text-sm flex-1 text-left">Skill Builder</span>
                        {getProviderState(SKILL_BUILDER_ID) === ProviderState.Connected && (
                          <Check size={16} className="shrink-0 text-neutral-600 dark:text-neutral-400" />
                        )}
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Agents section */}
              {agents.length > 0 && (
                <>
                  <div className="mx-3 mb-2 border-t border-neutral-200/60 dark:border-neutral-800/60" />
                  <div className="px-4 pb-1 flex items-center justify-between">
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Agents
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Add Agent"
                        onClick={() => {
                          setShowMobileSheet(false);
                          setWizardOpen(true);
                        }}
                        className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition-colors"
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        type="button"
                        title="Manage Agents"
                        onClick={() => {
                          setShowMobileSheet(false);
                          setAgentDrawerView("list");
                          setShowAgentDrawer(true);
                        }}
                        className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition-colors"
                      >
                        <Settings2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="px-2 pb-2">
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          setCurrentAgent(agent);
                          setShowMobileSheet(false);
                        }}
                        className={`group flex w-full items-center gap-3 px-3 py-1.5 rounded-xl transition-colors ${
                          currentAgent?.id === agent.id
                            ? "text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800"
                            : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-white/5"
                        }`}
                      >
                        <Bot size={16} className="shrink-0" />
                        <span className="font-medium text-sm flex-1 text-left truncate">{agent.name}</span>
                        {currentAgent?.id === agent.id && (
                          <>
                            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-neutral-300 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 leading-none">
                              Active
                            </span>
                            <button
                              type="button"
                              title="Deselect agent"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentAgent(null);
                                setShowMobileSheet(false);
                              }}
                              className="shrink-0 p-0.5 rounded-md text-neutral-400 hover:text-neutral-600 hover:bg-neutral-200 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 transition-colors"
                            >
                              <X size={13} />
                            </button>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
