import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Languages, PanelLeftOpen, Workflow, Disc3, ChevronDown, Settings } from "lucide-react";
import { ChatPage } from "./pages/ChatPage";
import { TranslatePage } from "./pages/TranslatePage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { RecorderPage } from "./pages/RecorderPage";
import { getConfig } from "./config";
import { SidebarProvider } from "./contexts/SidebarProvider";
import { useSidebar } from "./hooks/useSidebar";
import { NavigationProvider } from "./contexts/NavigationProvider";
import { useNavigation } from "./hooks/useNavigation";
import { ThemeProvider } from "./contexts/ThemeProvider";
import { LayoutProvider } from "./contexts/LayoutProvider";
import { BackgroundProvider } from "./contexts/BackgroundProvider";
import { ChatProvider } from "./contexts/ChatProvider";
import { TranslateProvider } from "./contexts/TranslateProvider";
import { VoiceProvider } from "./contexts/VoiceProvider";
import { SettingsButton } from "./components/SettingsButton";
import { SettingsModal } from "./components/SettingsModal";
import { RepositoryProvider } from "./contexts/RepositoryProvider";
import { ArtifactsProvider } from "./contexts/ArtifactsProvider";
import { ProfileProvider } from "./contexts/ProfileProvider";
import { ScreenCaptureProvider } from "./contexts/ScreenCaptureProvider";
import { ToolsProvider } from "./contexts/ToolsProvider";

type Page = "chat" | "flow" | "translate" | "recorder";

function AppContent() {
  const config = getConfig();
  const [currentPage, setCurrentPage] = useState<Page>("chat");
  const { showSidebar, setShowSidebar, toggleSidebar, sidebarContent } = useSidebar();
  const { leftActions, rightActions } = useNavigation();
  
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
        case '#translate':
          return config.translator.enabled ? 'translate' : 'chat';
        case '#flow':
          return config.workflow ? 'flow' : 'chat';
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
  }, [config.workflow, config.translator.enabled, config.recorder]);

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

  const pages = [
    { key: "chat" as const, label: "Chat", icon: <MessageCircle size={20} /> },
    { key: "flow" as const, label: "Flow", icon: <Workflow size={20} /> },
    { key: "translate" as const, label: "Translate", icon: <Languages size={20} /> },
    { key: "recorder" as const, label: "Recorder", icon: <Disc3 size={20} /> },
  ].filter(page => {
    // Always show chat
    if (page.key === "chat") return true;
    // Show flow only if workflow is enabled
    if (page.key === "flow") return config.workflow;
    // Show translate only if translator is enabled
    if (page.key === "translate") return config.translator.enabled;
    // Show recorder only if recorder is enabled
    if (page.key === "recorder") return config.recorder;
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
            onClick={() => {
              setShowSidebar(true);
            }}
            aria-label="Open sidebar"
          >
            <PanelLeftOpen size={20} />
          </button>
        </div>
      )}

      {/* Generic sidebar that pushes content */}
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

      {/* Main app content */}
      <div className={`flex-1 flex flex-col overflow-hidden relative z-10 transition-all duration-500 ease-in-out ${showSidebar && sidebarContent ? 'md:ml-[calc(14rem+0.75rem)]' : 'ml-0'}`}>
        {/* Fixed navigation bar with glass effect */}
        <nav className={`fixed top-0 left-0 right-0 z-30 px-3 py-2 bg-neutral-50/60 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-900 nav-header transition-all duration-500 ease-in-out ${showSidebar && sidebarContent ? 'md:left-[calc(14rem+0.75rem)]' : ''}`}>
          <div className="flex items-center justify-between">
            {/* Left section */}
            <div className="flex items-center gap-1 flex-1">
              {/* Fixed space for sidebar button - always reserve the space */}
              <div className="w-12 flex justify-start">
                {sidebarContent && (
                  <button
                    type="button"
                    className={`p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-300 ease-in-out hidden md:flex ${showSidebar ? 'opacity-0 pointer-events-none' : 'opacity-100 delay-300'}`}
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
                  {/* Animated slider background */}
                  <div
                    className="absolute bg-white dark:bg-neutral-950 rounded-full shadow-sm transition-all duration-300 ease-out"
                    style={{
                      left: `${sliderStyles.desktop.left}px`,
                      width: `${sliderStyles.desktop.width}px`,
                      height: 'calc(100% - 8px)',
                      top: '4px',
                    }}
                  />
                  
                  {pages.map(({ key, label, icon }) => (
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
                </div>
              </div>
            )}
            
            {/* Right section */}
            <div className="flex items-center gap-2 justify-end flex-1">
              {/* Hide settings button on mobile - it's in the menu */}
              <div className="hidden md:block">
                <SettingsButton />
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
        
        {/* Settings Modal for mobile menu */}
        <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        
        {/* Content area - no padding so it can scroll under the nav */}
        <div className="flex-1 overflow-hidden flex">
          {/* Main content */}
          <div className="flex-1 overflow-hidden">
            {currentPage === "chat" && <ChatPage />}
            {currentPage === "flow" && <WorkflowPage />}
            {currentPage === "translate" && <TranslatePage />}
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
  SidebarProvider,
  NavigationProvider,
  ArtifactsProvider,
  RepositoryProvider,
  ScreenCaptureProvider,
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
