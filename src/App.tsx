import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Languages, PanelLeftOpen, Workflow, Disc3, ChevronDown, Settings, Image, MoreHorizontal, Globe } from "lucide-react";
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from "@headlessui/react";
import { ChatPage } from "./features/chat/pages/ChatPage";
import { TranslatePage } from "./features/translate/pages/TranslatePage";
import { WorkflowPage } from "./features/workflow/pages/WorkflowPage";
import { RecorderPage } from "./features/recorder/pages/RecorderPage";
import { RendererPage } from "./features/renderer/pages/RendererPage";
import { ResearchPage } from "./features/research/pages/ResearchPage";
import { getConfig } from "./shared/config";
import { SidebarProvider } from "./shell/context/SidebarProvider";
import { useSidebar } from "./shell/hooks/useSidebar";
import { NavigationProvider } from "./shell/context/NavigationProvider";
import { useNavigation } from "./shell/hooks/useNavigation";
import { ThemeProvider } from "./shell/context/ThemeProvider";
import { LayoutProvider } from "./shell/context/LayoutProvider";
import { BackgroundProvider } from "./shell/context/BackgroundProvider";
import { ChatProvider } from "./features/chat/context/ChatProvider";
import { TranslateProvider } from "./features/translate/context/TranslateProvider";
import { VoiceProvider } from "./features/voice/context/VoiceProvider";
import { SettingsButton } from "./features/settings/components/SettingsButton";
import { SettingsDrawer } from "./features/settings/components/SettingsDrawer";
import { RepositoryProvider } from "./features/repository/context/RepositoryProvider";
import { SkillsProvider } from "./features/settings/context/SkillsProvider";
import { ArtifactsProvider } from "./features/artifacts/context/ArtifactsProvider";
import { AppProvider } from "./shell/context/AppProvider";
import { ProfileProvider } from "./features/settings/context/ProfileProvider";
import { ScreenCaptureProvider } from "./features/chat/context/ScreenCaptureProvider";
import { ToolsProvider } from "./features/tools/context/ToolsProvider";
import { BridgeProvider } from "./features/settings/context/BridgeProvider";
import { useArtifacts } from "./features/artifacts/hooks/useArtifacts";
import { useRepositories } from "./features/repository/hooks/useRepositories";
import { useApp } from "./shell/hooks/useApp";

type Page = "chat" | "flow" | "translate" | "renderer" | "research" | "recorder";

function AppContent() {
  const config = getConfig();
  const [currentPage, setCurrentPage] = useState<Page>("chat");
  const { showSidebar, setShowSidebar, toggleSidebar, sidebarContent } = useSidebar();
  const { leftActions, rightActions } = useNavigation();
  const { showArtifactsDrawer } = useArtifacts();
  const { showRepositoryDrawer } = useRepositories();
  const { showAppDrawer } = useApp();
  
  // Detect if any panel is open - sidebar becomes overlay when panels are open
  const hasPanelOpen = showArtifactsDrawer || showRepositoryDrawer || showAppDrawer;
  
  // Track previous panel state to detect when panels open (using state for adjust-during-render pattern)
  const [prevHasPanelOpen, setPrevHasPanelOpen] = useState(hasPanelOpen);
  
  // Auto-close sidebar when a panel opens (desktop only) - only on transition from closed to open
  // Using "adjust state during render" pattern to detect transitions
  if (hasPanelOpen !== prevHasPanelOpen) {
    setPrevHasPanelOpen(hasPanelOpen);
    // Check if panel just opened
    if (hasPanelOpen && !prevHasPanelOpen && showSidebar && window.innerWidth >= 768) {
      setShowSidebar(false);
    }
  }
  
  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Refs and state for animated slider (tablet and desktop only)
  const tabletRef = useRef<HTMLDivElement>(null);
  const desktopRef = useRef<HTMLDivElement>(null);
  const [sliderStyles, setSliderStyles] = useState({
    tablet: { left: 0, width: 0 },
    desktop: { left: 0, width: 0 }
  });

  // Shared function to update slider positions
  const updateSlider = useCallback((containerRef: React.RefObject<HTMLDivElement | null>, key: 'tablet' | 'desktop') => {
    if (containerRef.current) {
      const activeButton = containerRef.current.querySelector(`[data-page="${currentPage}"]`) as HTMLElement;
      if (activeButton) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();
        
        setSliderStyles(prev => ({
          ...prev,
          [key]: {
            left: buttonRect.left - containerRect.left,
            width: buttonRect.width
          }
        }));
      }
    }
  }, [currentPage]);

  // Update slider positions for all breakpoints
  useEffect(() => {
    // Initial update of all sliders
    setTimeout(() => {
      updateSlider(tabletRef, 'tablet');
      updateSlider(desktopRef, 'desktop');
    }, 0);
  }, [currentPage, updateSlider]);

  // Simple hash-based router
  useEffect(() => {
    const getPageFromHash = (hash: string): Page => {
      switch (hash) {
        case '#chat':
          return 'chat';
        case '#flow':
          return config.workflow ? 'flow' : 'chat';
        case '#translate':
          return config.translator ? 'translate' : 'chat';
        case '#renderer':
          return config.renderer ? 'renderer' : 'chat';
        case '#research':
          return config.researcher ? 'research' : 'chat';
        case '#recorder':
          return config.recorder ? 'recorder' : 'chat';
        default:
          return 'chat';
      }
    };

    const handleHashChange = () => {
      const page = getPageFromHash(window.location.hash);
      setCurrentPage(page);
    };

    // Set initial page from hash or set default hash if none exists
    if (!window.location.hash) {
      window.location.hash = '#chat';
    } else {
      handleHashChange();
    }

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [config.workflow, config.translator, config.recorder, config.renderer, config.researcher]);

  // Auto-close sidebar on mobile screens and update sliders on resize
  useEffect(() => {
    const handleResize = () => {
      // Auto-close sidebar on mobile
      if (window.innerWidth < 768) {
        setShowSidebar(false);
      }
      
      // Close mobile menu on resize to larger screens
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false);
      }
      
      // Update slider positions after a short delay
      setTimeout(() => {
        updateSlider(tabletRef, 'tablet');
        updateSlider(desktopRef, 'desktop');
      }, 100);
    };

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setShowSidebar, currentPage, updateSlider]);

  // Prevent default file-drop behavior on the rest of the page (avoid navigation)
  useEffect(() => {
    const preventDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('dragover', preventDrop);
    window.addEventListener('drop', preventDrop);
    return () => {
      window.removeEventListener('dragover', preventDrop);
      window.removeEventListener('drop', preventDrop);
    };
  }, []);

  // Primary pages always shown in main nav
  const primaryPages = [
    { key: "chat" as const, label: "Chat", icon: <MessageCircle size={20} /> },
    { key: "flow" as const, label: "Flow", icon: <Workflow size={20} /> },
    { key: "translate" as const, label: "Translate", icon: <Languages size={20} /> },
  ].filter(page => {
    if (page.key === "chat") return true;
    if (page.key === "flow") return !!config.workflow;
    if (page.key === "translate") return !!config.translator;
    return true;
  });

  // Secondary pages always in overflow menu
  const secondaryPages = [
    { key: "renderer" as const, label: "Renderer", icon: <Image size={20} /> },
    { key: "research" as const, label: "Research", icon: <Globe size={20} /> },
    { key: "recorder" as const, label: "Recorder", icon: <Disc3 size={20} /> },
  ].filter(page => {
    if (page.key === "renderer") return !!config.renderer;
    if (page.key === "research") return !!config.researcher;
    if (page.key === "recorder") return !!config.recorder;
    return true;
  });

  // All pages combined for mobile menu
  const pages = [...primaryPages, ...secondaryPages];

  const showNavigation = pages.length > 1;

  return (
    <div className="h-dvh w-dvw flex overflow-hidden relative">
      {/* Fixed hamburger button for mobile - only visible when sidebar is closed */}
      {sidebarContent && !showSidebar && (
        <div className="fixed top-0 left-0 z-40 md:hidden p-3">
          <button
            type="button"
            className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
            onClick={() => {
              setShowSidebar(true);
            }}
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
            ${showSidebar ? 'translate-x-0' : '-translate-x-[calc(100%+0.5rem)]'}
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
      <SettingsDrawer isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Main app content */}
      <div className={`flex-1 flex flex-col overflow-hidden relative z-10 transition-all duration-500 ease-in-out ${showSidebar && sidebarContent && !hasPanelOpen ? 'md:ml-59' : 'ml-0'}`}>
        {/* Fixed navigation bar with glass effect */}
        <nav className={`fixed top-0 left-0 right-0 z-30 px-3 py-2 bg-neutral-50/60 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-900 shadow-sm transition-all duration-500 ease-in-out ${showSidebar && sidebarContent && !hasPanelOpen ? 'md:left-59' : ''}`}>
          <div className="flex items-center justify-between">
            {/* Left section */}
            <div className="flex items-center gap-1 flex-1">
              {/* Fixed space for sidebar button - always reserve the space */}
              <div className="w-12 flex justify-start">
                {sidebarContent && (
                  <button
                    type="button"
                    className={`p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-500 ease-in-out hidden md:flex ${showSidebar ? 'opacity-0 pointer-events-none' : 'opacity-100 delay-500'}`}
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
                    {/* Current page button with dropdown indicator */}
                    <button
                      type="button"
                      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                      className="relative z-10 px-3 py-1.5 rounded-full font-medium transition-all duration-200 ease-out flex items-center gap-1.5 text-sm bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 shadow-sm"
                    >
                      {pages.find(p => p.key === currentPage)?.icon}
                      <span>{pages.find(p => p.key === currentPage)?.label}</span>
                      <ChevronDown 
                        size={14} 
                        className={`transition-transform duration-200 ${mobileMenuOpen ? 'rotate-180' : ''}`}
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
                  {/* Animated slider background - only show if current page is in primary pages */}
                  {primaryPages.some(p => p.key === currentPage) && (
                    <div
                      className="absolute bg-white dark:bg-neutral-950 rounded-full shadow-sm transition-all duration-300 ease-out"
                      style={{
                        left: `${sliderStyles.desktop.left}px`,
                        width: `${sliderStyles.desktop.width}px`,
                        height: 'calc(100% - 8px)',
                        top: '4px',
                      }}
                    />
                  )}
                  
                  {/* Primary navigation items */}
                  {primaryPages.map(({ key, label, icon }) => (
                    <button
                      type="button"
                      key={key}
                      data-page={key}
                      onClick={() => {
                        setCurrentPage(key);
                        window.location.hash = `#${key}`;
                      }}
                      className={`
                        relative z-10 px-3 py-1.5 rounded-full font-medium transition-all duration-200 ease-out
                        flex items-center gap-2 text-sm
                        ${currentPage === key
                          ? "text-neutral-900 dark:text-neutral-100"
                          : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                        }
                      `}
                    >
                      {icon}
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                  
                  {/* Overflow menu for secondary pages - always shown if there are secondary pages */}
                  {secondaryPages.length > 0 && (
                    <Menu>
                      <MenuButton
                        className={`
                          relative z-10 px-3 py-1.5 rounded-full font-medium transition-all duration-200 ease-out
                          flex items-center gap-2 text-sm
                          ${secondaryPages.some(p => p.key === currentPage)
                            ? "text-neutral-900 dark:text-neutral-100"
                            : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                          }
                        `}
                      >
                        <MoreHorizontal size={20} />
                      </MenuButton>
                      <MenuItems
                        modal={false}
                        transition
                        anchor="bottom"
                        className="mt-2 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-lg z-50 min-w-40"
                      >
                        {secondaryPages.map(({ key, label, icon }) => (
                          <MenuItem key={key}>
                            <button
                              type="button"
                              onClick={() => {
                                setCurrentPage(key);
                                window.location.hash = `#${key}`;
                              }}
                              className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors ${
                                currentPage === key
                                  ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
                                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                              }`}
                            >
                              {icon}
                              <span className="font-medium text-sm">{label}</span>
                            </button>
                          </MenuItem>
                        ))}
                      </MenuItems>
                    </Menu>
                  )}
                </div>
              </div>
            )}
            
            {/* Right section */}
            <div className="flex items-center gap-2 justify-end flex-1">
              {/* Hide settings button on mobile - it's in the menu */}
              <div className="hidden md:block">
                <SettingsButton onClick={() => setSettingsOpen(true)} />
              </div>
              {rightActions}
            </div>
          </div>
        </nav>
        
        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="fixed top-14 left-3 z-30 md:hidden bg-white dark:bg-neutral-900 backdrop-blur-md border border-neutral-200 dark:border-neutral-800 shadow-lg rounded-xl overflow-hidden min-w-40">
            <div className="py-1">
              {pages.map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setCurrentPage(key);
                    window.location.hash = `#${key}`;
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors ${
                    currentPage === key
                      ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  {icon}
                  <span className="font-medium text-sm">{label}</span>
                </button>
              ))}
              
              {/* Divider */}
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
              
              {/* Settings */}
              <button
                onClick={() => {
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
        {mobileMenuOpen && (
          <div 
            className="fixed inset-0 z-20 md:hidden" 
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        
        {/* Content area - no padding so it can scroll under the nav */}
        <div className="flex-1 overflow-hidden flex">
          {/* Main content */}
          <div className="flex-1 overflow-hidden">
            {currentPage === "chat" && <ChatPage />}
            {currentPage === "flow" && <WorkflowPage />}
            {currentPage === "translate" && <TranslatePage />}
            {currentPage === "renderer" && <RendererPage />}
            {currentPage === "research" && <ResearchPage />}
            {currentPage === "recorder" && <RecorderPage />}
          </div>
        </div>
      </div>
    </div>
  );
}

// Compose providers to avoid deep nesting
const providers = [
  ThemeProvider,
  LayoutProvider,
  BackgroundProvider,
  ProfileProvider,
  SkillsProvider,
  SidebarProvider,
  NavigationProvider,
  ArtifactsProvider,
  AppProvider,
  RepositoryProvider,
  ScreenCaptureProvider,
  BridgeProvider,
  ToolsProvider,
  ChatProvider,
  VoiceProvider,
  TranslateProvider,
];

function App() {
  return providers.reduceRight(
    (acc, Provider) => <Provider>{acc}</Provider>,
    <AppContent />
  );
}

export default App;
