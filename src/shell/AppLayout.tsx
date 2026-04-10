import { Transition } from "@headlessui/react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  Coffee,
  Globe,
  GraduationCap,
  Image,
  Languages,
  MessageCircle,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { SettingsButton } from "@/features/settings/components/SettingsButton";
import { SettingsDrawer } from "@/features/settings/components/SettingsDrawer";
import { useToolsContext } from "@/features/tools";
import { getConfig } from "@/shared/config";
import { useApp } from "@/shell/hooks/useApp";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";

type Page = "chat" | "translate" | "notebook" | "renderer";

function getPageFromPath(pathname: string): Page {
  const segment = pathname.split("/")[1] || "chat";
  switch (segment) {
    case "chat":
      return "chat";
    case "translate":
      return "translate";
    case "notebook":
      return "notebook";
    case "renderer":
      return "renderer";
    default:
      return "chat";
  }
}

export function AppLayout() {
  const config = getConfig();
  const currentPage = useRouterState({ select: (s) => getPageFromPath(s.location.pathname) });
  const { showSidebar, setShowSidebar, toggleSidebar, sidebarContent } = useSidebar();
  const { leftActions, rightActions } = useNavigation();
  const { showArtifactsDrawer } = useArtifacts();
  const { showAgentDrawer } = useAgents();
  const { showAppDrawer } = useApp();
  const { localWingmanAvailable, localWingmanEnabled } = useToolsContext();

  // Detect if any panel is open - sidebar becomes overlay when panels are open
  const hasPanelOpen = showArtifactsDrawer || showAgentDrawer || showAppDrawer;

  // Auto-close sidebar when a panel opens (desktop only)
  const prevHasPanelOpenRef = useRef(hasPanelOpen);
  useEffect(() => {
    const wasOpen = prevHasPanelOpenRef.current;
    prevHasPanelOpenRef.current = hasPanelOpen;
    if (hasPanelOpen && !wasOpen && showSidebar && window.innerWidth >= 768) {
      setShowSidebar(false);
    }
  }, [hasPanelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAdvanced, setSettingsAdvanced] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | undefined>(undefined);

  // Refs and state for animated slider (tablet and desktop only)
  const tabletRef = useRef<HTMLDivElement>(null);
  const desktopRef = useRef<HTMLDivElement>(null);
  const [sliderStyles, setSliderStyles] = useState({
    tablet: { left: 0, width: 0 },
    desktop: { left: 0, width: 0 },
  });

  // Shared function to update slider positions
  const updateSlider = useCallback(
    (containerRef: React.RefObject<HTMLDivElement | null>, key: "tablet" | "desktop") => {
      if (containerRef.current) {
        const activeButton = containerRef.current.querySelector(`[data-page="${currentPage}"]`) as HTMLElement;
        if (activeButton) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const buttonRect = activeButton.getBoundingClientRect();

          setSliderStyles((prev) => ({
            ...prev,
            [key]: {
              left: buttonRect.left - containerRect.left,
              width: buttonRect.width,
            },
          }));
        }
      }
    },
    [currentPage],
  );

  // Update slider positions for all breakpoints
  useEffect(() => {
    setTimeout(() => {
      updateSlider(tabletRef, "tablet");
      updateSlider(desktopRef, "desktop");
    }, 0);
  }, [currentPage, updateSlider]);

  // Auto-close sidebar on mobile screens and update sliders on resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setShowSidebar(false);
      }
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false);
      }
      setTimeout(() => {
        updateSlider(tabletRef, "tablet");
        updateSlider(desktopRef, "desktop");
      }, 100);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setShowSidebar, currentPage, updateSlider]);

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
    { key: "notebook" as const, label: "Notebook", icon: <Globe size={20} />, to: "/notebook" },
    { key: "translate" as const, label: "Translate", icon: <Languages size={20} />, to: "/translate" },
    { key: "renderer" as const, label: "Canvas", icon: <Image size={20} />, to: "/renderer" },
  ].filter((page) => {
    if (page.key === "chat") return true;
    if (page.key === "translate") return !!config.translator;
    if (page.key === "notebook") return !!config.notebook;
    if (page.key === "renderer") return !!config.renderer;
    return true;
  });
  const showNavigation = pages.length > 1;

  return (
    <div className="h-dvh w-dvw flex overflow-hidden relative">
      {/* Fixed hamburger button for mobile - only visible when sidebar is closed */}
      {sidebarContent && !showSidebar && (
        <div className="fixed top-0 left-0 z-40 md:hidden p-3">
          <button
            type="button"
            className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
            onClick={() => setShowSidebar(true)}
            aria-label="Open sidebar"
          >
            <PanelLeftOpen size={20} />
          </button>
        </div>
      )}

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
        <div
          className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60 hidden md:block"
          onClick={() => setShowSidebar(false)}
        />
      </Transition>

      {/* Generic sidebar - pushes content normally, becomes overlay when panels are open */}
      {sidebarContent && (
        <aside
          className={`
            fixed z-50
            transition-transform duration-500 ease-in-out
            ${showSidebar ? "translate-x-0" : "-translate-x-[calc(100%+0.5rem)]"}
            left-0 top-0 bottom-0 right-0 w-full h-full
            md:w-56 md:left-2 md:top-2 md:bottom-2 md:right-auto md:h-auto
            md:rounded-lg md:border md:border-neutral-200/60 md:dark:border-neutral-700/60 md:shadow-sm
            overflow-hidden
          `}
        >
          {sidebarContent}
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
        className={`flex-1 flex flex-col overflow-hidden relative z-10 transition-all duration-500 ease-in-out ${showSidebar && sidebarContent && !hasPanelOpen ? "md:ml-59" : "ml-0"}`}
      >
        {/* Fixed navigation bar with glass effect */}
        <nav
          className={`fixed top-0 left-0 right-0 z-30 px-3 py-2 bg-neutral-50/60 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-900 shadow-sm transition-[padding] duration-500 ease-in-out ${showSidebar && sidebarContent && !hasPanelOpen ? "md:pl-62" : ""}`}
        >
          <div className="flex items-center justify-between">
            {/* Left section */}
            <div className="flex items-center gap-1 flex-1">
              {/* Fixed space for sidebar button - always reserve the space */}
              <div className="w-12 flex justify-start">
                {sidebarContent && (
                  <button
                    type="button"
                    className={`p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-500 ease-in-out hidden md:flex ${showSidebar ? "opacity-0 pointer-events-none" : "opacity-100 delay-500"}`}
                    onClick={toggleSidebar}
                    aria-label="Open sidebar"
                  >
                    <PanelLeftOpen size={20} />
                  </button>
                )}
              </div>

              {/* Mobile hamburger menu - visible on smaller screens */}
              {showNavigation && (
                <div className="flex items-center md:hidden -ml-2 relative">
                  <div className="relative flex items-center bg-neutral-200/30 dark:bg-neutral-800/40 backdrop-blur-sm rounded-full p-1 shadow-sm border border-neutral-300/20 dark:border-neutral-700/20">
                    <button
                      type="button"
                      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                      className="relative z-10 px-3 py-1.5 rounded-full font-medium transition-all duration-200 ease-out flex items-center gap-1.5 text-sm bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 shadow-sm"
                    >
                      {pages.find((p) => p.key === currentPage)?.icon}
                      <span>{pages.find((p) => p.key === currentPage)?.label}</span>
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${mobileMenuOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                </div>
              )}

              {leftActions}
            </div>

            {/* Center section - Modern pill navigation for desktop */}
            {showNavigation && (
              <div className="hidden md:flex items-center justify-center">
                <div
                  ref={desktopRef}
                  className="relative flex items-center bg-neutral-200/30 dark:bg-neutral-800/40 backdrop-blur-sm rounded-full p-1 shadow-sm border border-neutral-300/20 dark:border-neutral-700/20"
                >
                  {/* Animated slider background */}
                  {pages.some((p) => p.key === currentPage) && (
                    <div
                      className="absolute bg-white dark:bg-neutral-950 rounded-full shadow-sm transition-all duration-300 ease-out"
                      style={{
                        left: `${sliderStyles.desktop.left}px`,
                        width: `${sliderStyles.desktop.width}px`,
                        height: "calc(100% - 8px)",
                        top: "4px",
                      }}
                    />
                  )}

                  {/* Navigation items */}
                  {pages.map(({ key, label, icon, to }) => (
                    <Link
                      key={key}
                      to={to}
                      data-page={key}
                      className={`
                        relative z-10 px-3 py-1.5 rounded-full font-medium transition-all duration-200 ease-out
                        flex items-center gap-2 text-sm cursor-pointer
                        ${currentPage === key ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"}
                      `}
                    >
                      {icon}
                      <span className="hidden sm:inline">{label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Right section */}
            <div className="flex items-center gap-2 justify-end flex-1">
              {localWingmanAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    setSettingsInitialSection("companion");
                    setSettingsAdvanced(false);
                    setSettingsOpen(true);
                  }}
                  className={`p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 ${localWingmanEnabled ? "" : "opacity-40"}`}
                  title="Companion"
                >
                  <Coffee size={20} />
                </button>
              )}
              {config.support?.url && (
                <a
                  href={config.support.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                  title="Support"
                >
                  <GraduationCap size={24} />
                </a>
              )}
              <div className="hidden md:block">
                <SettingsButton
                  onClick={(e) => {
                    setSettingsInitialSection(undefined);
                    setSettingsAdvanced(e.altKey);
                    setSettingsOpen(true);
                  }}
                />
              </div>
              {rightActions}
            </div>
          </div>
        </nav>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="fixed top-14 left-3 z-30 md:hidden bg-white dark:bg-neutral-900 backdrop-blur-md border border-neutral-200 dark:border-neutral-800 shadow-lg rounded-xl overflow-hidden min-w-40">
            <div className="py-1">
              {pages.map(({ key, label, icon, to }) => (
                <Link
                  key={key}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors ${
                    currentPage === key
                      ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {icon}
                  <span className="font-medium text-sm">{label}</span>
                </Link>
              ))}

              <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />

              <button
                onClick={(e) => {
                  setSettingsInitialSection(undefined);
                  setSettingsAdvanced(e.altKey);
                  setSettingsOpen(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full px-4 py-2.5 flex items-center gap-3 text-left text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <Settings size={20} />
                <span className="font-medium text-sm">Settings</span>
              </button>
            </div>
          </div>
        )}

        {/* Mobile menu backdrop */}
        {mobileMenuOpen && <div className="fixed inset-0 z-20 md:hidden" onClick={() => setMobileMenuOpen(false)} />}

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
