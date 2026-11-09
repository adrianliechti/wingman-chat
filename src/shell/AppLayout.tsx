import { Transition } from "@headlessui/react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Coffee, Image, Languages, MessageCircle, PanelLeftOpen } from "lucide-react";
import { ViewTransition, useCallback, useEffect, useRef, useState } from "react";
import { useVisualViewport } from "@/shared/hooks/useVisualViewport";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useProjects } from "@/features/projects/context/ProjectsContext";
import { AccountLinks, AccountMenu } from "@/features/settings/components/AccountMenu";
import { SettingsDrawer } from "@/features/settings/components/SettingsDrawer";
import { SyncIndicator } from "@/features/settings/components/SyncIndicator";
import { useToolsContext } from "@/features/tools";
import { COMPANION_ID } from "@/features/tools/hooks/useCompanion";
import { getConfig } from "@/shared/config";
import { useBreakpoint, useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import { ProviderState } from "@/shared/types/chat";
import { useApp } from "@/shell/hooks/useApp";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";

type Page = "chat" | "translate" | "canvas";

function getPageFromPath(pathname: string): Page {
  const segment = pathname.split("/")[1] || "chat";
  switch (segment) {
    case "chat":
      return "chat";
    case "translate":
      return "translate";
    case "canvas":
      return "canvas";
    default:
      return "chat";
  }
}

export function AppLayout() {
  const config = getConfig();
  const currentPage = useRouterState({ select: (s) => getPageFromPath(s.location.pathname) });
  const {
    showSidebar,
    setShowSidebar,
    toggleSidebar,
    sidebarContent,
    sidebarWidth,
    isSidebarResizing,
    handleSidebarResizeMouseDown,
    resetSidebarWidth,
  } = useSidebar();
  const { leftActions, rightActions } = useNavigation();
  const { showArtifactsDrawer } = useArtifacts();
  const { showAgentDrawer, currentAgent } = useAgents();
  const { showAppDrawer } = useApp();
  const { editingProjectId } = useProjects();
  const { companionAvailable, companionEnabled, getProviderState } = useToolsContext();
  // Header indicator reflects the companion's actual availability: the live
  // connection state under an agent (its config decides), the persisted global
  // flag otherwise.
  const companionActive = currentAgent ? getProviderState(COMPANION_ID) === ProviderState.Connected : companionEnabled;

  // Detect if any panel is open - sidebar becomes overlay when panels are open
  const hasPanelOpen =
    !(currentPage === "chat" && editingProjectId) && (showArtifactsDrawer || showAgentDrawer || showAppDrawer);

  // Auto-close sidebar when a panel opens (desktop only)
  const prevHasPanelOpenRef = useRef(hasPanelOpen);
  useEffect(() => {
    const wasOpen = prevHasPanelOpenRef.current;
    prevHasPanelOpenRef.current = hasPanelOpen;
    if (hasPanelOpen && !wasOpen && showSidebar && window.innerWidth >= 768) {
      setShowSidebar(false);
    }
  }, [hasPanelOpen, showSidebar, setShowSidebar]);

  // Track desktop breakpoint so the sidebar width is only applied on md+
  // (mobile keeps its full-width overlay).
  const isDesktop = useBreakpoint("md");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // Share the visible viewport with pages and portaled sheets at every width.
  useVisualViewport();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAdvanced, setSettingsAdvanced] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | undefined>(undefined);

  const openSettings = useCallback(({ advanced, section }: { advanced: boolean; section?: string }) => {
    setSettingsInitialSection(section);
    setSettingsAdvanced(advanced);
    setSettingsOpen(true);
  }, []);

  // React to breakpoint changes; the active tab's highlight follows its own
  // layout and React coordinates the shared-element navigation animation.
  useEffect(() => {
    if (!isDesktop) setShowSidebar(false);
  }, [isDesktop, setShowSidebar]);

  // Prevent default file-drop behavior on the rest of the page (avoid navigation)
  useEffect(() => {
    const preventDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("dragover", preventDrop);
    window.addEventListener("drop", preventDrop);
    return () => {
      window.removeEventListener("dragover", preventDrop);
      window.removeEventListener("drop", preventDrop);
    };
  }, []);

  // Navigation pages
  const pages = [
    { key: "chat" as const, label: "Chat", icon: <MessageCircle size={20} />, to: "/chat" },
    {
      key: "translate" as const,
      label: "Translate",
      icon: <Languages size={20} />,
      to: "/translate",
    },
    { key: "canvas" as const, label: "Canvas", icon: <Image size={20} />, to: "/canvas" },
  ].filter((page) => {
    if (page.key === "chat") return true;
    if (page.key === "translate") return !!config.translator;
    if (page.key === "canvas") return !!config.renderer;
    return true;
  });
  // `config.navigation: false` hides the tab bar entirely — only Chat is shown.
  const showNavigation = config.navigation && pages.length > 1;

  // On desktop the sidebar pushes content aside; when a panel is open it becomes
  // an overlay instead, and on mobile it's always a full-width overlay.
  const sidebarPushesContent = isDesktop && showSidebar && !!sidebarContent && !hasPanelOpen;
  // Phones keep the drawer even on pages without their own list (e.g. Canvas):
  // it still carries the page switch and the account row.
  const hasDrawer = !!sidebarContent || (!isDesktop && showNavigation);

  return (
    <div className="h-(--app-height) top-(--app-viewport-top) w-dvw pl-(--safe-left) pr-(--safe-right) flex overflow-hidden relative">
      {/* Backdrop for overlay sidebar when panels are open */}
      <Transition
        show={!!(sidebarContent && hasPanelOpen && showSidebar)}
        enter="ease-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="ease-in duration-200"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60 hidden md:block"
          onClick={() => setShowSidebar(false)}
        />
      </Transition>

      {/* Generic sidebar - pushes content normally, becomes overlay when panels are open.
          A tinted, translucent surface sets it apart from the content instead of a border,
          so it reads as one column from the top bar to the bottom edge. */}
      {hasDrawer && (
        <aside
          className={cn(
            "fixed app-viewport left-0 z-50 flex w-full flex-col overflow-hidden pl-(--safe-left) pr-(--safe-right) md:pt-(--safe-top) md:pb-(--safe-bottom) bg-neutral-100/85 backdrop-blur-xl transition-transform duration-500 ease-in-out md:right-auto dark:bg-neutral-900/85",
            // Phones: a frosted page that starts under the status bar and slides with an iOS curve.
            "max-md:bg-(--glass-bg-strong) max-md:pt-(--safe-top) max-md:backdrop-blur-2xl max-md:backdrop-saturate-150 max-md:duration-400 max-md:ease-[cubic-bezier(0.32,0.72,0,1)]",
            showSidebar ? "translate-x-0" : "-translate-x-full",
            hasPanelOpen && "md:shadow-2xl md:shadow-black/15 dark:md:shadow-black/50",
          )}
          style={isDesktop ? { width: sidebarWidth } : undefined}
          onTouchStart={(e) => {
            (e.currentTarget as HTMLElement).dataset.swipeStartX = String(e.touches[0].clientX);
          }}
          onTouchEnd={(e) => {
            const startX = Number((e.currentTarget as HTMLElement).dataset.swipeStartX ?? 0);
            const deltaX = startX - e.changedTouches[0].clientX;
            if (deltaX > 50) setShowSidebar(false);
          }}
        >
          {/* Phones: the page switch lives at the top of the drawer, like a native segmented control. */}
          {showNavigation && (
            <div className="shrink-0 px-3 pt-2 pb-1 md:hidden">
              <div className="flex rounded-full bg-black/6 p-1 dark:bg-white/10">
                {pages.map(({ key, label, icon, to }) => (
                  <Link
                    key={key}
                    to={to}
                    onClick={() => setShowSidebar(false)}
                    className={cn(
                      "press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold",
                      currentPage === key
                        ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50"
                        : "text-neutral-600 dark:text-neutral-400",
                    )}
                  >
                    {icon}
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1">{sidebarContent}</div>

          {/* Phones: links and Settings sit flat at the bottom of the drawer. */}
          <div className="shrink-0 border-t border-black/8 px-2 pt-1.5 pb-[max(var(--safe-bottom),0.5rem)] md:hidden dark:border-white/10">
            <AccountLinks onOpenSettings={openSettings} />
          </div>

          {/* Resize handle — desktop only. Drag to resize, double-click to reset. */}
          <button
            type="button"
            aria-label="Resize sidebar"
            className="hidden md:flex absolute top-0 bottom-0 right-0 w-3 z-10 group items-center justify-center cursor-ew-resize"
            onMouseDown={handleSidebarResizeMouseDown}
            onDoubleClick={resetSidebarWidth}
          >
            <div className="bg-neutral-300 rounded-sm dark:bg-neutral-700 shadow-sm opacity-0 group-hover:opacity-60 transition-opacity">
              <div className="grid grid-cols-1 justify-items-center gap-0.5 px-0.5 py-1.5">
                <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
                <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
                <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
                <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
                <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
                <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
              </div>
            </div>
          </button>
        </aside>
      )}

      {/* Settings Drawer - must be outside the z-10 content wrapper */}
      <SettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        showAdvanced={settingsAdvanced}
        initialSection={settingsInitialSection}
      />

      {/* Main app content */}
      <div
        className={cn(
          "flex-1 flex flex-col overflow-hidden relative z-10 ease-in-out",
          !isSidebarResizing && "transition-all duration-500",
        )}
        style={{ marginLeft: sidebarPushesContent ? sidebarWidth : 0 }}
      >
        {/* Fixed navigation bar with glass effect */}
        <nav
          data-app-topbar
          className={cn(
            "fixed top-(--app-viewport-top) left-0 right-0 z-30 pl-[max(var(--safe-left),0.75rem)] pr-[max(var(--safe-right),0.75rem)] ease-in-out",
            // Desktop: one translucent bar with a hairline.
            "md:pb-2 md:bg-neutral-50/60 md:dark:bg-neutral-950/80 md:backdrop-blur-sm md:border-b md:border-neutral-200 md:dark:border-neutral-800 md:shadow-sm",
            // Phones: no bar at all. Glass controls float over the page, which scrolls
            // beneath them and fades out under the status bar.
            "pt-[calc(var(--safe-top)+0.5rem)] max-md:pointer-events-none max-md:pb-2",
            !isSidebarResizing && "transition-[padding] duration-500",
          )}
          style={sidebarPushesContent ? { paddingLeft: sidebarWidth + 12 } : undefined}
        >
          <div
            aria-hidden="true"
            className="scroll-edge-top absolute inset-x-0 top-0 -z-10 h-[calc(var(--safe-top)+5.25rem)] md:hidden"
          />
          <div className="flex items-center justify-between">
            {/* Left section */}
            <div className="flex items-center gap-1 flex-1 max-md:gap-2">
              {/* Fixed space for sidebar button - always reserve the space */}
              <div className="w-12 flex justify-start max-md:w-auto">
                {hasDrawer && (
                  <button
                    type="button"
                    className={cn(
                      "flex items-center justify-center",
                      "max-md:glass max-md:press max-md:pointer-events-auto max-md:size-11 max-md:rounded-full max-md:text-neutral-800 max-md:dark:text-neutral-100",
                      "md:p-2 md:rounded md:text-neutral-600 md:dark:text-neutral-400 md:hover:text-neutral-800 md:dark:hover:text-neutral-200 md:transition-all md:duration-500 md:ease-in-out",
                      showSidebar ? "md:opacity-0 md:pointer-events-none" : "md:opacity-100 md:delay-500",
                    )}
                    onClick={toggleSidebar}
                    aria-label="Open sidebar"
                  >
                    <PanelLeftOpen size={20} />
                  </button>
                )}
              </div>

              {leftActions && <div className="max-md:pointer-events-auto">{leftActions}</div>}
            </div>

            {/* Center section - Modern pill navigation for desktop */}
            {showNavigation && (
              <div className="hidden md:flex items-center justify-center">
                <div className="relative flex items-center bg-neutral-200/30 dark:bg-neutral-800/40 backdrop-blur-sm rounded-full p-1 shadow-sm border border-neutral-300/20 dark:border-neutral-700/20">
                  {/* Navigation items */}
                  {pages.map(({ key, label, icon, to }) => (
                    <Link
                      key={key}
                      to={to}
                      data-page={key}
                      className={cn(
                        "relative isolate z-10 px-3 py-1.5 rounded-full font-medium transition-colors duration-200 ease-out",
                        "flex items-center gap-2 text-sm cursor-pointer",
                        currentPage === key
                          ? "text-neutral-900 dark:text-neutral-100"
                          : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
                      )}
                    >
                      {currentPage === key && (
                        <ViewTransition
                          name="navigation-highlight"
                          default={reducedMotion ? "none" : "navigation-highlight"}
                        >
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-white shadow-sm dark:bg-neutral-950"
                          />
                        </ViewTransition>
                      )}
                      {icon}
                      <span className="hidden sm:inline">{label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Right section. Phones group the page actions in one glass capsule
                and keep the account avatar as its own round glass button. */}
            <div className="flex items-center gap-2 justify-end flex-1">
              <div className="flex items-center gap-2 max-md:glass max-md:pointer-events-auto max-md:h-11 max-md:gap-0 max-md:rounded-full max-md:px-0.5 max-md:empty:hidden">
                {companionAvailable && (
                  <button
                    type="button"
                    onClick={() => openSettings({ advanced: false, section: "companion" })}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full press text-neutral-700 dark:text-neutral-300 md:size-auto md:rounded md:p-2 md:text-neutral-600 md:dark:text-neutral-400 md:transition-all md:duration-150 md:ease-out hover:text-neutral-800 dark:hover:text-neutral-200",
                      !companionActive && "opacity-40",
                    )}
                    title="Companion"
                  >
                    <Coffee size={20} />
                  </button>
                )}
                <SyncIndicator onClick={() => openSettings({ advanced: false, section: "backup" })} />
                {rightActions}
              </div>
              {/* Phones reach the account from the sidebar footer instead. */}
              <div className="hidden md:block">
                <AccountMenu onOpenSettings={openSettings} />
              </div>
            </div>
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 overflow-hidden">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
