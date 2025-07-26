import { useState, useEffect } from "react";
import { MessageCircle, Languages, PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { Button } from "@headlessui/react";
import { ChatPage } from "./pages/ChatPage";
import { TranslatePage } from "./pages/TranslatePage";
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
import { RepositoryProvider } from "./contexts/RepositoryProvider";
import { ArtifactsProvider } from "./contexts/ArtifactsProvider";
import { BridgeProvider } from "./contexts/BridgeProvider";
import { ProfileProvider } from "./contexts/ProfileProvider";
import { BridgeIndicator } from "./components/BridgeIndicator";

type Page = "chat" | "translate";

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>("chat");
  const { showSidebar, setShowSidebar, toggleSidebar, sidebarContent } = useSidebar();
  const { leftActions, rightActions } = useNavigation();

  // Simple hash-based router
  useEffect(() => {
    const getPageFromHash = (hash: string): Page => {
      switch (hash) {
        case '#chat':
          return 'chat';
        case '#translate':
          return 'translate';
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
  }, []);

  // Auto-close sidebar on mobile screens on mount and resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setShowSidebar(false);
      }
    };

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setShowSidebar]);

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

  const pages: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: "chat", label: "Chat", icon: <MessageCircle size={20} /> },
    { key: "translate", label: "Translate", icon: <Languages size={20} /> },
  ];

  return (
    <div className="h-dvh w-dvw flex overflow-hidden relative">
      {/* Fixed hamburger button for mobile - only visible when sidebar is closed */}
      {sidebarContent && !showSidebar && (
        <div className="fixed top-0 left-0 z-40 md:hidden p-3">
          <Button
            className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
            onClick={() => {
              setShowSidebar(true);
            }}
            aria-label="Open sidebar"
          >
            <PanelLeftOpen size={20} />
          </Button>
        </div>
      )}

      {/* Backdrop overlay for sidebar */}
      {sidebarContent && showSidebar && (
        <div
          className={`fixed inset-0 bg-black/5 z-40 transition-opacity duration-300 opacity-100`}
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Generic sidebar that slides over content with glass effect */}
      {sidebarContent && (
        <aside
          className={`
            h-full bg-white/20 dark:bg-black/15 backdrop-blur-lg shadow-2xl
            fixed left-0 top-0 z-50 w-80
            transform transition-transform duration-500 ease-in-out
            ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          {sidebarContent}
        </aside>
      )}

      {/* Main app content */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Fixed navigation bar with glass effect */}
        <nav className="fixed top-0 left-0 right-0 z-30 px-3 py-2 bg-neutral-50/60 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-900 nav-header">
          <div className="flex items-center justify-between">
            {/* Left section */}
            <div className="flex items-center flex-1">
              {/* Fixed space for hamburger menu - always reserve the space */}
              <div className="w-12 flex justify-start">
                {sidebarContent && (
                  <Button
                    className={`p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out hidden md:flex ${showSidebar ? 'sidebar-open' : ''}`}
                    onClick={toggleSidebar}
                    aria-label={showSidebar ? 'Close sidebar' : 'Open sidebar'}
                  >
                    {showSidebar ? <PanelRightOpen size={20} /> : <PanelLeftOpen size={20} />}
                  </Button>
                )}
              </div>
              {leftActions}
            </div>
            
            {/* Center section - Tab buttons */}
            <div className="flex items-center justify-center">
              {pages.map(({ key, label, icon }) => (
                <Button
                  key={key}
                  onClick={() => {
                    setCurrentPage(key);
                    window.location.hash = `#${key}`;
                  }}
                  className={`px-3 py-2 font-medium transition-colors flex items-center gap-2 relative ${
                    currentPage === key
                      ? "text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  {icon}
                  <span className="hidden sm:inline">{label}</span>
                  {/* Underline for active tab */}
                  {currentPage === key && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-900 dark:bg-neutral-100"></div>
                  )}
                </Button>
              ))}
            </div>
            
            {/* Right section */}
            <div className="flex items-center gap-2 justify-end flex-1">
              <SettingsButton />
              <BridgeIndicator />
              {rightActions}
            </div>
          </div>
        </nav>
        
        {/* Content area - no padding so it can scroll under the nav */}
        <div className="flex-1 overflow-hidden flex">
          {/* Main content */}
          <div className="flex-1 overflow-hidden">
            {currentPage === "chat" && <ChatPage />}
            {currentPage === "translate" && <TranslatePage />}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LayoutProvider>
        <BackgroundProvider>
          <ProfileProvider>
            <SidebarProvider>
              <NavigationProvider>
                <BridgeProvider>
                  <RepositoryProvider>
                    <ArtifactsProvider>
                      <ChatProvider>
                        <VoiceProvider>
                          <TranslateProvider>
                            <AppContent />
                          </TranslateProvider>
                        </VoiceProvider>
                      </ChatProvider>
                    </ArtifactsProvider>
                  </RepositoryProvider>
                </BridgeProvider>
              </NavigationProvider>
            </SidebarProvider>
          </ProfileProvider>
        </BackgroundProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}

export default App;
