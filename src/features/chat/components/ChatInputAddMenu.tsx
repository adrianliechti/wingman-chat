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
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  ScreenShare,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentWizard } from "@/features/agent/components/wizard/AgentWizard";
import { useAgentFiles } from "@/features/agent/hooks/useAgentFiles";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
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
  onAttachmentClick,
  onContinuousCaptureToggle,
  onTranscriptionClick,
  onDriveSelect,
}: ChatInputAddMenuProps) {
  const config = getConfig();
  const { agents, currentAgent, setCurrentAgent, setShowAgentDrawer, setAgentDrawerView } = useAgents();

  const [showMobileSheet, setShowMobileSheet] = useState(false);

  // File submenu
  const [showFileSubmenu, setShowFileSubmenu] = useState(false);
  const [fileSubmenuPos, setFileSubmenuPos] = useState<{ top: number; left: number } | null>(null);
  const fileMenuRef = useRef<HTMLButtonElement>(null);
  const fileMenuPanelRef = useRef<HTMLDivElement>(null);
  const fileSubmenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Agent submenu
  const [showAgentSubmenu, setShowAgentSubmenu] = useState(false);
  const [agentSubmenuPos, setAgentSubmenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const agentMenuRef = useRef<HTMLButtonElement>(null);
  const agentSubmenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          <MenuButton
            className="p-2.5 md:pl-1.5 md:pr-0.5 md:py-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            title="Add"
            aria-label="Add"
          >
            <Plus size={16} />
          </MenuButton>
          <MenuItems
            modal={false}
            transition
            anchor="bottom end"
            ref={fileMenuPanelRef}
            className="max-h-[60vh]! mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-y-auto shadow-lg shadow-black/20 dark:shadow-black/50 z-50 min-w-40 dark:ring-1 dark:ring-white/10 py-1"
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
                        "group flex w-full items-center gap-3 px-4 py-1.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 transition-colors",
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
                ref={fileMenuRef}
                type="button"
                onClick={() => (config.drives.length === 0 ? onAttachmentClick() : undefined)}
                onMouseEnter={() => {
                  if (fileSubmenuTimer.current) clearTimeout(fileSubmenuTimer.current);
                  if (config.drives.length === 0) return;
                  const rect = (fileMenuPanelRef.current ?? fileMenuRef.current)?.getBoundingClientRect();
                  if (rect) setFileSubmenuPos({ top: rect.top, left: rect.right });
                  setShowFileSubmenu(true);
                }}
                onMouseLeave={() => {
                  fileSubmenuTimer.current = setTimeout(() => setShowFileSubmenu(false), 150);
                }}
                className="group flex w-full items-center gap-3 px-4 py-1.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors"
              >
                <Paperclip size={16} className="shrink-0" />
                <span className="font-medium text-sm flex-1 text-left">Add File</span>
                {config.drives.length > 0 && <ChevronRight size={14} className="shrink-0 text-neutral-400" />}
              </button>
            </MenuItem>
            {showFileSubmenu &&
              fileSubmenuPos &&
              createPortal(
                <div
                  data-file-submenu
                  role="none"
                  style={{ top: fileSubmenuPos.top, left: fileSubmenuPos.left }}
                  className="fixed z-9999 pl-2"
                  onMouseEnter={() => {
                    if (fileSubmenuTimer.current) clearTimeout(fileSubmenuTimer.current);
                    setShowFileSubmenu(true);
                  }}
                  onMouseLeave={() => {
                    fileSubmenuTimer.current = setTimeout(() => setShowFileSubmenu(false), 150);
                  }}
                >
                  <div className="rounded-xl border-2 bg-white/70 dark:bg-neutral-950/90 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 shadow-lg shadow-black/20 dark:shadow-black/50 dark:ring-1 dark:ring-white/10 py-1 min-w-40">
                    <button
                      type="button"
                      onClick={onAttachmentClick}
                      className="flex w-full items-center gap-3 px-4 py-1.5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <Paperclip size={16} className="shrink-0" />
                      <span className="font-medium text-sm">Upload</span>
                    </button>
                    {config.drives.map((fp) => (
                      <button
                        key={fp.id}
                        type="button"
                        onClick={() => {
                          setShowFileSubmenu(false);
                          onDriveSelect(fp);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-1.5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
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
            <MenuItem>
              <button
                ref={agentMenuRef}
                type="button"
                onMouseEnter={() => {
                  if (agentSubmenuTimer.current) clearTimeout(agentSubmenuTimer.current);
                  const panelRect = fileMenuPanelRef.current?.getBoundingClientRect();
                  const buttonRect = agentMenuRef.current?.getBoundingClientRect();
                  if (panelRect && buttonRect)
                    setAgentSubmenuPos({
                      top: buttonRect.top,
                      left: panelRect.right,
                      maxHeight: window.innerHeight - buttonRect.top - 16,
                    });
                  setShowAgentSubmenu(true);
                }}
                onMouseLeave={() => {
                  agentSubmenuTimer.current = setTimeout(() => setShowAgentSubmenu(false), 150);
                }}
                className="group flex w-full items-center gap-3 px-4 py-1.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors"
              >
                <Bot size={16} className="shrink-0" />
                <span className="font-medium text-sm flex-1 text-left">Agents</span>
                <ChevronRight size={14} className="shrink-0 text-neutral-400" />
              </button>
            </MenuItem>
            {showAgentSubmenu &&
              agentSubmenuPos &&
              createPortal(
                <div
                  data-agent-submenu
                  role="none"
                  style={{ top: agentSubmenuPos.top, left: agentSubmenuPos.left }}
                  className="fixed z-9999 pl-2"
                  onMouseEnter={() => {
                    if (agentSubmenuTimer.current) clearTimeout(agentSubmenuTimer.current);
                    setShowAgentSubmenu(true);
                  }}
                  onMouseLeave={() => {
                    agentSubmenuTimer.current = setTimeout(() => setShowAgentSubmenu(false), 150);
                  }}
                >
                  <div
                    style={{ maxHeight: agentSubmenuPos.maxHeight }}
                    className="rounded-xl border-2 bg-white/70 dark:bg-neutral-950/90 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 shadow-lg shadow-black/20 dark:shadow-black/50 dark:ring-1 dark:ring-white/10 py-1 min-w-48 flex flex-col overflow-hidden"
                  >
                    {agents.length === 0 && (
                      <p className="px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400">No agents configured</p>
                    )}
                    <div className="overflow-y-auto">
                      {agents.map((agent) => (
                        <div
                          key={agent.id}
                          className="group/agent flex w-full items-center hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentAgent(agent);
                              setShowAgentSubmenu(false);
                              setAgentDrawerView("details");
                              setShowAgentDrawer(true);
                            }}
                            className="flex flex-1 min-w-0 items-center gap-3 px-4 py-1.5"
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
                        setShowAgentSubmenu(false);
                        setWizardOpen(true);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-1.5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <Plus size={16} className="shrink-0" />
                      <span className="font-medium text-sm">Add Agent</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAgentSubmenu(false);
                        setAgentDrawerView("list");
                        setShowAgentDrawer(true);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-1.5 hover:bg-neutral-100/60 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-colors"
                    >
                      <FolderCog size={16} className="shrink-0" />
                      <span className="font-medium text-sm">Manage Agents</span>
                    </button>
                  </div>
                </div>,
                document.body,
              )}
            {visibleProviders.length > 0 && (
              <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
            )}
            {visibleProviders.map((provider: ToolProvider) => {
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
                          await setProviderEnabled(provider.id, !providerEnabled);
                        } catch (error) {
                          console.error(`Failed to toggle provider ${provider.name}:`, error);
                        }
                      }}
                      disabled={providerInitializing}
                      className="group flex w-full items-center gap-3 px-4 py-1.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors disabled:opacity-50"
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
              {visibleProviders.length > 0 && (
                <>
                  <div className="mx-3 mb-2 border-t border-neutral-200/60 dark:border-neutral-800/60" />
                  <div className="px-4 pb-1">
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Connectors
                    </p>
                  </div>
                  <div className="px-2">
                    {visibleProviders.map((provider: ToolProvider) => {
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
                              await setProviderEnabled(provider.id, !providerEnabled);
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
                  <div className="mx-4 my-2 border-t border-neutral-200/60 dark:border-neutral-800/60" />
                </>
              )}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
