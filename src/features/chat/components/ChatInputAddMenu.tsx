import {
  autoUpdate,
  FloatingFocusManager,
  FloatingList,
  FloatingNode,
  FloatingPortal,
  FloatingTree,
  flip,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useFloatingTree,
  useHover,
  useInteractions,
  useListItem,
  useListNavigation,
  useMergeRefs,
  useRole,
  useTransitionStyles,
  useTypeahead,
} from "@floating-ui/react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  Bot,
  Check,
  ChevronRight,
  FolderCog,
  HardDrive,
  LoaderCircle,
  Lock,
  Mic,
  Paperclip,
  PenTool,
  Plus,
  Puzzle,
  ScreenShare,
  Settings2,
  Sparkles,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AgentWizard } from "@/features/agent/components/wizard/AgentWizard";
import { useAgentFiles } from "@/features/agent/hooks/useAgentFiles";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { pluginProviderId, PLUGIN_PROVIDER_PREFIX } from "@/features/plugins/lib/pluginProvider";
import { SKILL_BUILDER_ID } from "@/features/skills/hooks/useSkillBuilderProvider";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { SKILLS_PROVIDER_ID, type SkillSources } from "@/features/skills/lib/skillsProvider";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import type { ToolProvider } from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";
import { Tooltip } from "@/shared/ui/Tooltip";

// ─── Floating UI menu primitives ──────────────────────────────────────────────
// The Add menu and its flyouts share one FloatingTree, so the root's tree-aware
// useDismiss treats a click inside a (portaled) submenu as "inside" — no manual
// outside-click guard needed to keep the menu open while toggling submenu items.

const MENU_PANEL_CLASS =
  "rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1";

const ROW_CLASS =
  "group flex w-full items-center gap-3 px-3 py-2 rounded-lg text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-white/5 focus:bg-neutral-100/60 dark:focus:bg-white/5 focus:outline-none transition-colors";

interface MenuContextValue {
  getItemProps: (userProps?: React.HTMLProps<HTMLElement>) => Record<string, unknown>;
  activeIndex: number | null;
  closeMenu: () => void;
}

const MenuContext = createContext<MenuContextValue>({
  getItemProps: () => ({}),
  activeIndex: null,
  closeMenu: () => {},
});

/** Root of the Add menu: owns the FloatingTree and the top-level item list. */
function AddMenu({ children }: { children: ReactNode }) {
  return (
    <FloatingTree>
      <AddMenuRoot>{children}</AddMenuRoot>
    </FloatingTree>
  );
}

function AddMenuRoot({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const elementsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>([]);

  const tree = useFloatingTree();
  const nodeId = useFloatingNodeId();

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top-start",
    middleware: [offset(8), flip({ fallbackPlacements: ["bottom-start"] }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const role = useRole(context, { role: "menu" });
  const dismiss = useDismiss(context, { bubbles: true });
  const listNavigation = useListNavigation(context, {
    listRef: elementsRef,
    activeIndex,
    onNavigate: setActiveIndex,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    onMatch: isOpen ? setActiveIndex : undefined,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    role,
    dismiss,
    listNavigation,
    typeahead,
  ]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 100,
    initial: { opacity: 0, transform: "scale(0.95)" },
  });

  // Any leaf item that activates emits a tree "click" to close the whole menu.
  useEffect(() => {
    if (!tree) return;
    const close = () => setIsOpen(false);
    tree.events.on("click", close);
    return () => tree.events.off("click", close);
  }, [tree]);

  const closeMenu = useCallback(() => tree?.events.emit("click"), [tree]);

  return (
    <FloatingNode id={nodeId}>
      <Tooltip content="Add files, tools and more" side="bottom">
        <button
          ref={refs.setReference}
          type="button"
          aria-label="Add"
          className="p-2.5 md:pl-1.5 md:pr-0.5 md:py-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
          {...getReferenceProps()}
        >
          <Plus size={16} />
        </button>
      </Tooltip>
      <MenuContext.Provider value={{ getItemProps, activeIndex, closeMenu }}>
        <FloatingList elementsRef={elementsRef} labelsRef={labelsRef}>
          {isMounted && (
            <FloatingPortal>
              <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
                <div
                  ref={refs.setFloating}
                  style={floatingStyles}
                  className="z-50"
                  {...getFloatingProps()}
                >
                  <div
                    style={transitionStyles}
                    className={cn(MENU_PANEL_CLASS, "max-h-[60vh] overflow-y-auto min-w-40")}
                  >
                    {children}
                  </div>
                </div>
              </FloatingFocusManager>
            </FloatingPortal>
          )}
        </FloatingList>
      </MenuContext.Provider>
    </FloatingNode>
  );
}

interface MenuRowProps {
  /** Label used for typeahead; not rendered (pass display content as children). */
  label: string;
  /** Emit a tree close after selecting. Toggles (which keep the menu open) pass false. */
  closeOnClick?: boolean;
  disabled?: boolean;
  onSelect?: () => void | Promise<void>;
  className?: string;
  children: ReactNode;
}

/** A focusable leaf row in the Add menu, wired for keyboard list navigation. */
function MenuRow({
  label,
  closeOnClick = true,
  disabled,
  onSelect,
  className,
  children,
}: MenuRowProps) {
  const menu = useContext(MenuContext);
  const item = useListItem({ label: disabled ? null : label });
  const isActive = item.index === menu.activeIndex;

  return (
    <button
      ref={item.ref}
      type="button"
      role="menuitem"
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      className={cn(ROW_CLASS, className)}
      {...menu.getItemProps({
        onClick() {
          if (disabled) return;
          void onSelect?.();
          if (closeOnClick) menu.closeMenu();
        },
      })}
    >
      {children}
    </button>
  );
}

interface SubmenuProps {
  label: string;
  icon: ReactNode;
  /** Extra classes for the inner panel (min-width, flex layout, max-height). */
  panelClassName?: string;
  /** Receives a `close` that collapses the whole menu (for navigating actions). */
  children: (close: () => void) => ReactNode;
}

/**
 * A hover-activated flyout that is also a row in its parent menu. It registers as a
 * list item (so keyboard navigation reaches it) and opens its own FloatingNode in the
 * shared tree; the portal escapes the parent's scroll clipping, and useHover +
 * safePolygon keeps it open while the cursor travels diagonally onto the panel.
 */
function Submenu({ label, icon, panelClassName, children }: SubmenuProps) {
  const parent = useContext(MenuContext);
  const item = useListItem({ label });
  const isActive = item.index === parent.activeIndex;

  const [isOpen, setIsOpen] = useState(false);

  const tree = useFloatingTree();
  const nodeId = useFloatingNodeId();
  const parentId = useFloatingParentNodeId();

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "right-start",
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ["right-end", "left-start", "left-end"] }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { handleClose: safePolygon(), delay: { close: 150 } });
  const click = useClick(context, { event: "mousedown", toggle: false, ignoreMouse: true });
  const dismiss = useDismiss(context, { bubbles: true });
  const role = useRole(context, { role: "menu" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss, role]);

  const triggerRef = useMergeRefs([refs.setReference, item.ref]);

  // Collapse when a sibling submenu opens.
  useEffect(() => {
    if (!tree) return;
    const onSiblingOpen = (event: { nodeId: string; parentId: string | null }) => {
      if (event.nodeId !== nodeId && event.parentId === parentId) setIsOpen(false);
    };
    tree.events.on("menuopen", onSiblingOpen);
    return () => tree.events.off("menuopen", onSiblingOpen);
  }, [tree, nodeId, parentId]);
  useEffect(() => {
    if (isOpen && tree) tree.events.emit("menuopen", { nodeId, parentId });
  }, [tree, isOpen, nodeId, parentId]);

  const close = useCallback(() => tree?.events.emit("click"), [tree]);

  return (
    <FloatingNode id={nodeId}>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        tabIndex={isActive ? 0 : -1}
        data-open={isOpen ? "" : undefined}
        className={ROW_CLASS}
        {...getReferenceProps(parent.getItemProps())}
      >
        {icon}
        <span className="font-medium text-sm flex-1 text-left">{label}</span>
        <ChevronRight size={14} className="shrink-0 text-neutral-400" />
      </button>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-9999"
            {...getFloatingProps()}
          >
            <div className={cn(MENU_PANEL_CLASS, panelClassName)}>{children(close)}</div>
          </div>
        </FloatingPortal>
      )}
    </FloatingNode>
  );
}

interface ChatInputAddMenuProps {
  isScreenCaptureAvailable: boolean;
  isContinuousCaptureActive: boolean;
  canTranscribe: boolean;
  isTranscribing: boolean;
  isResponding: boolean;
  visibleProviders: ToolProvider[];
  getProviderState: (id: string) => ProviderState;
  getProviderPolicy: (id: string) => "required" | "optional";
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
  getProviderPolicy,
  setProviderEnabled,
  skillSources,
  setSkillSources,
  onAttachmentClick,
  onContinuousCaptureToggle,
  onTranscriptionClick,
  onDriveSelect,
}: ChatInputAddMenuProps) {
  const config = getConfig();
  const { agents, currentAgent, setCurrentAgent, setShowAgentDrawer, setAgentDrawerView } =
    useAgents();
  const { skills, openSkillCatalog } = useSkills();
  const { plugins } = usePlugins();
  const openPluginsManager = () => openSkillCatalog(undefined, false, "plugins");
  // Show the Plugins entry whenever there's something installed or a hub to
  // browse — otherwise there'd be no way to discover/install the first plugin.
  const showPluginsMenu = plugins.length > 0 || Boolean(config.plugins?.url);

  const otherProviders = visibleProviders.filter(
    (p) =>
      p.id !== SKILLS_PROVIDER_ID &&
      p.id !== SKILL_BUILDER_ID &&
      p.id !== "repository" &&
      p.id !== "memory" &&
      !p.id.startsWith(PLUGIN_PROVIDER_PREFIX),
  );
  const skillBuilder = visibleProviders.find((p) => p.id === SKILL_BUILDER_ID);
  const showSkillsMenu = !currentAgent;
  const showSkillsPluginsMenu = showSkillsMenu || showPluginsMenu;

  const toggleSkillSource = useCallback(
    (key: "personal" | "catalog") => {
      setSkillSources({ ...skillSources, [key]: !skillSources[key] });
    },
    [skillSources, setSkillSources],
  );

  const [showMobileSheet, setShowMobileSheet] = useState(false);

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
    const providerConnecting =
      state === ProviderState.Initializing || state === ProviderState.Authenticating;
    const providerUnauthorized = state === ProviderState.Unauthorized;
    const providerFailed = state === ProviderState.Failed;

    if (providerConnecting) return <LoaderCircle size={16} className="animate-spin" />;
    if (providerUnauthorized) return <Lock size={16} className="text-amber-500" />;
    if (providerFailed) return <TriangleAlert size={16} />;
    if (typeof icon === "string")
      return <McpProviderIcon src={icon} size={16} className="shrink-0 object-contain" />;
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
        <AddMenu>
          {/* Add File — a direct attach when no drives are configured, otherwise a submenu */}
          {config.drives.length === 0 ? (
            <MenuRow label="Add File" onSelect={onAttachmentClick}>
              <Paperclip size={16} className="shrink-0" />
              <span className="font-medium text-sm flex-1 text-left">Add File</span>
            </MenuRow>
          ) : (
            <Submenu
              label="Add File"
              icon={<Paperclip size={16} className="shrink-0" />}
              panelClassName="min-w-40"
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onAttachmentClick();
                      close();
                    }}
                    className={ROW_CLASS}
                  >
                    <Paperclip size={16} className="shrink-0" />
                    <span className="font-medium text-sm">Upload</span>
                  </button>
                  {config.drives.map((fp) => (
                    <button
                      key={fp.id}
                      type="button"
                      onClick={() => {
                        onDriveSelect(fp);
                        close();
                      }}
                      className={ROW_CLASS}
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
                </>
              )}
            </Submenu>
          )}
          {isScreenCaptureAvailable && (
            <Tooltip
              content={
                isContinuousCaptureActive
                  ? "Stop sharing — removes the live screen feed from the conversation"
                  : "Share your screen continuously as context for the conversation"
              }
              side="right"
              className="w-full"
            >
              <MenuRow
                label={isContinuousCaptureActive ? "Stop Screen Capture" : "Share Screen"}
                onSelect={onContinuousCaptureToggle}
                className={
                  isContinuousCaptureActive ? "text-green-600 dark:text-green-400" : undefined
                }
              >
                <ScreenShare size={16} className="shrink-0" />
                <span className="font-medium text-sm">
                  {isContinuousCaptureActive ? "Stop Screen Capture" : "Share Screen"}
                </span>
              </MenuRow>
            </Tooltip>
          )}
          {showSkillsPluginsMenu && (
            <Submenu
              label="Skills / Plugins"
              icon={<Sparkles size={16} className="shrink-0" />}
              panelClassName="min-w-48 flex flex-col overflow-hidden max-h-[min(60vh,400px)]"
            >
              {(close) => (
                <div className="overflow-y-auto flex flex-col">
                  {showSkillsMenu && (
                    <>
                      <Tooltip
                        content="Skills you've created — editable in Manage"
                        side="right"
                        className="w-full"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSkillSource("personal")}
                          className={ROW_CLASS}
                        >
                          <User size={16} className="shrink-0" />
                          <span className="font-medium text-sm flex-1 text-left">
                            My Skills{" "}
                            <span className="text-neutral-400 dark:text-neutral-500">
                              ({skills.length})
                            </span>
                          </span>
                          <span className="shrink-0 w-4 flex justify-center">
                            {skillSources.personal && (
                              <Check size={13} className="text-neutral-600 dark:text-neutral-400" />
                            )}
                          </span>
                        </button>
                      </Tooltip>
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
                          className={ROW_CLASS}
                        >
                          <PenTool size={16} className="shrink-0" />
                          <span className="font-medium text-sm flex-1 text-left">
                            Skill Builder
                          </span>
                          <span className="shrink-0 w-4 flex justify-center">
                            {getProviderState(SKILL_BUILDER_ID) === ProviderState.Connected && (
                              <Check size={13} className="text-neutral-600 dark:text-neutral-400" />
                            )}
                          </span>
                        </button>
                      )}
                    </>
                  )}
                  {showPluginsMenu && (
                    <>
                      {showSkillsMenu && (
                        <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
                      )}
                      {plugins.length > 0 && (
                        <>
                          {plugins.map((plugin) => {
                            const providerId = pluginProviderId(plugin.id);
                            const state = getProviderState(providerId);
                            const enabled = state === ProviderState.Connected;
                            const required = getProviderPolicy(providerId) === "required";
                            return (
                              <Tooltip
                                key={plugin.id}
                                content={
                                  required
                                    ? `${plugin.title || plugin.id} is required by this agent`
                                    : (plugin.description ??
                                      `Enable "${plugin.title || plugin.id}" for this conversation`)
                                }
                                side="right"
                                className="w-full"
                              >
                                <MenuRow
                                  label={plugin.title || plugin.id}
                                  closeOnClick={false}
                                  disabled={required}
                                  onSelect={async () => {
                                    try {
                                      await setProviderEnabled(providerId, !enabled);
                                    } catch (error) {
                                      console.error(`Failed to toggle plugin ${plugin.id}:`, error);
                                    }
                                  }}
                                >
                                  {plugin.icon ? (
                                    <img
                                      src={plugin.icon}
                                      alt=""
                                      className="h-4 w-4 shrink-0 rounded object-contain"
                                    />
                                  ) : (
                                    <Puzzle size={16} className="shrink-0" />
                                  )}
                                  <span className="font-medium text-sm flex-1 text-left truncate">
                                    {plugin.title || plugin.id}
                                  </span>
                                  <span className="shrink-0 w-4 flex justify-center">
                                    {required ? (
                                      <Lock
                                        size={12}
                                        className="text-neutral-400 dark:text-neutral-500"
                                      />
                                    ) : (
                                      enabled && (
                                        <Check
                                          size={13}
                                          className="text-neutral-600 dark:text-neutral-400"
                                        />
                                      )
                                    )}
                                  </span>
                                </MenuRow>
                              </Tooltip>
                            );
                          })}
                        </>
                      )}
                    </>
                  )}
                  <div className="border-t border-neutral-200 dark:border-neutral-700 mt-1" />
                  <button
                    type="button"
                    onClick={() => {
                      openPluginsManager();
                      close();
                    }}
                    className={ROW_CLASS}
                  >
                    <FolderCog size={16} className="shrink-0" />
                    <span className="font-medium text-sm">Manage</span>
                  </button>
                </div>
              )}
            </Submenu>
          )}
          <Submenu
            label="Agents"
            icon={<Bot size={16} className="shrink-0" />}
            panelClassName="min-w-48 flex flex-col overflow-hidden max-h-[min(60vh,400px)]"
          >
            {(close) => (
              <>
                {agents.length === 0 && (
                  <p className="px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400">
                    No agents configured
                  </p>
                )}
                <div className="overflow-y-auto">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        setCurrentAgent(agent);
                        setAgentDrawerView("details");
                        setShowAgentDrawer(true);
                        close();
                      }}
                      className={ROW_CLASS}
                    >
                      <Bot size={16} className="shrink-0" />
                      <span className="font-medium text-sm flex-1 text-left truncate">
                        {agent.name}
                      </span>
                      {currentAgent?.id === agent.id && (
                        <Check
                          size={13}
                          className="shrink-0 ml-1 text-neutral-600 dark:text-neutral-400"
                        />
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-neutral-200 dark:border-neutral-700 mt-1" />
                <button
                  type="button"
                  onClick={() => {
                    setWizardOpen(true);
                    close();
                  }}
                  className={ROW_CLASS}
                >
                  <Plus size={16} className="shrink-0" />
                  <span className="font-medium text-sm">Add Agent</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgentDrawerView("list");
                    setShowAgentDrawer(true);
                    close();
                  }}
                  className={ROW_CLASS}
                >
                  <FolderCog size={16} className="shrink-0" />
                  <span className="font-medium text-sm">Manage Agents</span>
                </button>
              </>
            )}
          </Submenu>
          {otherProviders.length > 0 && (
            <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
          )}
          {otherProviders.map((provider: ToolProvider) => {
            const state = getProviderState(provider.id);
            const providerEnabled = state === ProviderState.Connected;
            const providerConnecting =
              state === ProviderState.Initializing || state === ProviderState.Authenticating;
            const providerUnauthorized = state === ProviderState.Unauthorized;
            const providerFailed = state === ProviderState.Failed;
            const providerRequired = getProviderPolicy(provider.id) === "required";

            return (
              <Tooltip
                key={provider.id}
                content={
                  providerRequired
                    ? `${provider.name} is required by this agent`
                    : providerUnauthorized
                      ? `Sign in required for ${provider.name}`
                      : providerFailed
                        ? `${provider.name} failed to connect`
                        : providerConnecting
                          ? `${provider.name} is connecting…`
                          : (provider.description ??
                            (providerEnabled
                              ? `Disable ${provider.name} tools for this conversation`
                              : `Enable ${provider.name} tools for this conversation`))
                }
                side="right"
                className="w-full"
              >
                <MenuRow
                  label={provider.name}
                  closeOnClick={false}
                  disabled={providerConnecting || providerRequired}
                  onSelect={async () => {
                    try {
                      await setProviderEnabled(provider.id, !providerEnabled);
                    } catch (error) {
                      console.error(`Failed to toggle provider ${provider.name}:`, error);
                    }
                  }}
                  className={cn(providerConnecting && !providerRequired && "opacity-50")}
                >
                  {renderProviderIcon(provider, state)}
                  <span className="font-medium text-sm flex-1 text-left truncate">
                    {provider.name}
                  </span>
                  <span className="shrink-0 w-4 flex justify-center">
                    {providerRequired ? (
                      <Lock size={12} className="text-neutral-400 dark:text-neutral-500" />
                    ) : (
                      providerEnabled &&
                      !providerConnecting &&
                      !providerFailed && (
                        <Check size={13} className="ml-1 text-neutral-600 dark:text-neutral-400" />
                      )
                    )}
                  </span>
                </MenuRow>
              </Tooltip>
            );
          })}
        </AddMenu>
      </div>

      <AgentWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={handleWizardCreated}
      />

      {/* Mobile bottom sheet — attach, screen capture, recording, and features */}
      <Dialog
        open={showMobileSheet}
        onClose={setShowMobileSheet}
        className="relative z-50 md:hidden"
      >
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
                    <span className="text-xs font-medium leading-tight text-center">
                      Start Recording
                    </span>
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
                      const providerConnecting =
                        state === ProviderState.Initializing ||
                        state === ProviderState.Authenticating;
                      const providerUnauthorized = state === ProviderState.Unauthorized;
                      const providerFailed = state === ProviderState.Failed;
                      const providerRequired = getProviderPolicy(provider.id) === "required";

                      return (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (providerConnecting || providerRequired) return;
                            try {
                              await setProviderEnabled(provider.id, !providerEnabled);
                            } catch (error) {
                              console.error(`Failed to toggle provider ${provider.name}:`, error);
                            }
                          }}
                          disabled={providerConnecting || providerRequired}
                          className={`flex w-full items-center gap-3 px-3 py-1.5 rounded-xl transition-colors ${
                            providerConnecting && !providerRequired ? "opacity-50" : ""
                          } ${
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
                                {providerRequired ? "Required by this agent" : provider.description}
                              </span>
                            )}
                          </div>
                          {providerRequired ? (
                            <Lock
                              size={15}
                              className="shrink-0 text-neutral-400 dark:text-neutral-500"
                            />
                          ) : (
                            <>
                              {providerEnabled && !providerConnecting && !providerFailed && (
                                <Check
                                  size={16}
                                  className="shrink-0 text-neutral-600 dark:text-neutral-400"
                                />
                              )}
                              {providerUnauthorized && (
                                <Lock size={16} className="shrink-0 text-amber-500" />
                              )}
                              {providerFailed && (
                                <TriangleAlert size={16} className="shrink-0 text-neutral-400" />
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Skills / Plugins section */}
              {showSkillsPluginsMenu && (
                <>
                  <div className="mx-3 mb-2 border-t border-neutral-200/60 dark:border-neutral-800/60" />
                  <div className="px-4 pb-1 flex items-center justify-between">
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Skills / Plugins
                    </p>
                    <button
                      type="button"
                      title="Manage"
                      onClick={() => {
                        setShowMobileSheet(false);
                        openPluginsManager();
                      }}
                      className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition-colors"
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                  <div className="px-2 pb-2">
                    {showSkillsMenu && (
                      <>
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
                            My Skills{" "}
                            <span className="text-neutral-400 dark:text-neutral-500">
                              ({skills.length})
                            </span>
                          </span>
                          {skillSources.personal && (
                            <Check
                              size={16}
                              className="shrink-0 text-neutral-600 dark:text-neutral-400"
                            />
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
                            <span className="font-medium text-sm flex-1 text-left">
                              Skill Builder
                            </span>
                            {getProviderState(SKILL_BUILDER_ID) === ProviderState.Connected && (
                              <Check
                                size={16}
                                className="shrink-0 text-neutral-600 dark:text-neutral-400"
                              />
                            )}
                          </button>
                        )}
                      </>
                    )}
                    {showPluginsMenu && plugins.length > 0 && (
                      <>
                        {showSkillsMenu && (
                          <div className="my-1 border-t border-neutral-200/60 dark:border-neutral-800/60" />
                        )}
                        {plugins.map((plugin) => {
                          const providerId = pluginProviderId(plugin.id);
                          const state = getProviderState(providerId);
                          const enabled = state === ProviderState.Connected;
                          const required = getProviderPolicy(providerId) === "required";
                          return (
                            <button
                              key={plugin.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (required) return;
                                void setProviderEnabled(providerId, !enabled).catch((error) =>
                                  console.error(`Failed to toggle plugin ${plugin.id}:`, error),
                                );
                              }}
                              disabled={required}
                              className={`flex w-full items-center gap-3 px-3 py-1.5 rounded-xl transition-colors ${
                                enabled
                                  ? "text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800"
                                  : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-white/5"
                              }`}
                            >
                              {plugin.icon ? (
                                <img
                                  src={plugin.icon}
                                  alt=""
                                  className="h-4 w-4 shrink-0 rounded object-contain"
                                />
                              ) : (
                                <Puzzle size={16} className="shrink-0" />
                              )}
                              <span className="font-medium text-sm flex-1 text-left truncate">
                                {plugin.title || plugin.id}
                              </span>
                              {required ? (
                                <Lock
                                  size={16}
                                  className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                />
                              ) : (
                                enabled && (
                                  <Check
                                    size={16}
                                    className="shrink-0 text-neutral-600 dark:text-neutral-400"
                                  />
                                )
                              )}
                            </button>
                          );
                        })}
                      </>
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
                        <span className="font-medium text-sm flex-1 text-left truncate">
                          {agent.name}
                        </span>
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
