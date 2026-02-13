import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Plus as PlusIcon, Package, PackageOpen, Info, ArrowDown, BookOpenText, BookText, Rocket } from "lucide-react";
import DOMPurify from "dompurify";
import { getConfig } from "@/shared/config";
import { useAutoScroll } from "@/shared/hooks/useAutoScroll";
import { useSidebar } from "@/shell/hooks/useSidebar";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useLayout } from "@/shell/hooks/useLayout";
import { useChat } from "@/features/chat/hooks/useChat";
import { useBackground } from "@/shell/hooks/useBackground";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { ChatMessage } from "@/features/chat/components/ChatMessage";
import { ChatSidebar } from "@/features/chat/components/ChatSidebar";
import { BackgroundImage } from "@/shell/components/BackgroundImage";
import { useRepositories } from "@/features/repository/hooks/useRepositories";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useApp } from "@/shell/hooks/useApp";
import { RepositoryDrawer } from "@/features/repository/components/RepositoryDrawer";
import { ArtifactsDrawer } from "@/features/artifacts/components/ArtifactsDrawer";
import { AppDrawer } from "@/shell/components/AppDrawer";

// Custom hook to handle drawer animation state
function useDrawerAnimation(isOpen: boolean) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    let animationTimer: NodeJS.Timeout | undefined;
    let removeTimer: NodeJS.Timeout | undefined;

    if (isOpen) {
      // Schedule render first, then animate
      const renderTimer = setTimeout(() => {
        setShouldRender(true);
        animationTimer = setTimeout(() => setIsAnimating(true), 10);
      }, 0);
      return () => {
        clearTimeout(renderTimer);
        if (animationTimer) clearTimeout(animationTimer);
      };
    } else {
      // Schedule animation removal first, then unmount
      animationTimer = setTimeout(() => setIsAnimating(false), 0);
      removeTimer = setTimeout(() => setShouldRender(false), 300);
      return () => {
        if (animationTimer) clearTimeout(animationTimer);
        if (removeTimer) clearTimeout(removeTimer);
      };
    }
  }, [isOpen]);

  return { isAnimating, shouldRender };
}

// Memoized disclaimer component to avoid re-computing on every render
const Disclaimer = () => {
  const disclaimer = useMemo(() => {
    try {
      const config = getConfig();
      const sanitized = DOMPurify.sanitize(config.disclaimer);
      return sanitized?.trim() || null;
    } catch {
      return null;
    }
  }, []);

  if (!disclaimer) return null;

  return (
    <div className="mb-6 mx-auto max-w-2xl">
      <div className="flex items-start justify-center gap-2 px-4 py-3">
        <Info size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
        <p
          className="text-xs text-neutral-600 dark:text-neutral-400 text-left"
          dangerouslySetInnerHTML={{ __html: disclaimer }}
        />
      </div>
    </div>
  );
};

export function ChatPage() {
  const {
    chat,
    messages,
    createChat,
    chats,
    isResponding,
  } = useChat();
  
  const { layoutMode } = useLayout();
  const { isAvailable: artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer } = useArtifacts();
  const { isAvailable: repositoryAvailable, toggleRepositoryDrawer, showRepositoryDrawer } = useRepositories();
  const { showAppDrawer, toggleAppDrawer, hasAppContent } = useApp();
  
  // Only need backgroundImage to check if background should be shown
  const { backgroundImage } = useBackground();
  
  // Drawer animation states using custom hook
  const { isAnimating: isRepositoryDrawerAnimating, shouldRender: shouldRenderRepositoryDrawer } = useDrawerAnimation(showRepositoryDrawer);
  const { isAnimating: isArtifactsDrawerAnimating, shouldRender: shouldRenderArtifactsDrawer } = useDrawerAnimation(showArtifactsDrawer);
  const { isAnimating: isAppDrawerAnimating, shouldRender: shouldRenderAppDrawer } = useDrawerAnimation(showAppDrawer);
  
  // Track if we're on mobile for drawer positioning
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  
  // Sidebar integration (now only controls visibility)
  const { setSidebarContent, showSidebar } = useSidebar();
  const { setRightActions } = useNavigation();

  const { containerRef, bottomRef, enableAutoScroll, isAutoScrollEnabled } = useAutoScroll({
    dependencies: [chat, messages],
  });

  // Ref to track chat input height for dynamic padding
  const [chatInputHeight, setChatInputHeight] = useState(112); // Default to pb-28 (7rem = 112px)

  // Track window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Set up navigation actions
  useEffect(() => {
    setRightActions(
      <div className="flex items-center gap-2">
        {hasAppContent && (
          <button
            type="button"
            className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            onClick={toggleAppDrawer}
            title={showAppDrawer ? 'Close app' : 'Open app'}
          >
            <Rocket size={20} />
          </button>
        )}
        {repositoryAvailable && (
          <button
            type="button"
            className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            onClick={toggleRepositoryDrawer}
            title={showRepositoryDrawer ? 'Close repositories' : 'Open repositories'}
          >
            {showRepositoryDrawer ? <PackageOpen size={20} /> : <Package size={20} />}
          </button>
        )}
        {artifactsAvailable && (
          <button
            type="button"
            className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            onClick={toggleArtifactsDrawer}
            title={showArtifactsDrawer ? 'Close artifacts' : 'Open artifacts'}
          >
            {showArtifactsDrawer ? <BookOpenText size={20} /> : <BookText size={20} />}
          </button>
        )}
        <button
          type="button"
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
          onClick={createChat}
        >
          <PlusIcon size={20} />
        </button>
      </div>
    );

    // Cleanup when component unmounts
    return () => {
      setRightActions(null);
    };
  }, [setRightActions, createChat, artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer, repositoryAvailable, showRepositoryDrawer, toggleRepositoryDrawer, hasAppContent, showAppDrawer, toggleAppDrawer]);

  // Create sidebar content with useMemo to avoid infinite re-renders
  const sidebarContent = useMemo(() => {
    // Only show sidebar if there are chats
    if (chats.length === 0) {
      return null;
    }
    return <ChatSidebar />;
  }, [chats.length]);

  // Set up sidebar content when it changes
  useEffect(() => {
    setSidebarContent(sidebarContent);
    return () => setSidebarContent(null);
  }, [sidebarContent, setSidebarContent]);

  // Ref to cache the footer element
  const footerElementRef = useRef<Element | null>(null);

  // Memoized height observer callback
  const observeHeight = useCallback(() => {
    const element = footerElementRef.current ?? document.querySelector('footer form');
    if (element) {
      footerElementRef.current = element;
      const height = element.getBoundingClientRect().height;
      setChatInputHeight(height + 16);
    }
  }, []);

  // Observer for chat input height changes to adjust message container padding
  useEffect(() => {
    // Initial measurement after a short delay to ensure DOM is ready
    const timer = setTimeout(observeHeight, 100);

    // Create a MutationObserver to watch for changes in the footer area
    const mutationObserver = new MutationObserver(observeHeight);

    // Use ResizeObserver to watch for height changes
    const resizeObserver = new ResizeObserver(observeHeight);

    // Start observing once the footer element exists
    const startObserving = () => {
      const footerElement = document.querySelector('footer form');
      if (footerElement) {
        footerElementRef.current = footerElement;
        resizeObserver.observe(footerElement);
        mutationObserver.observe(footerElement, { 
          childList: true, 
          subtree: true, 
          characterData: true 
        });
      } else {
        // If footer doesn't exist yet, try again after a short delay
        setTimeout(startObserving, 50);
      }
    };

    startObserving();

    // Also listen for window resize as a fallback
    window.addEventListener('resize', observeHeight);

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', observeHeight);
    };
  }, [observeHeight]);

  return (
    <div className="h-full w-full flex overflow-hidden relative">
      <BackgroundImage opacity={messages.length === 0 ? 80 : 0} />
      
      {/* Main content area */}
      <div className={`flex-1 flex flex-col overflow-hidden relative transition-all duration-500 ease-in-out ${
        showAppDrawer ? 'md:mr-[calc(66vw+0.75rem)]' :
        showArtifactsDrawer ? 'md:mr-[calc(66vw+0.75rem)]' : 
        showRepositoryDrawer ? 'md:mr-83' : ''
      }`}>
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center pt-16 relative">
              <div className="flex flex-col items-center text-center relative z-10 w-full max-w-4xl px-4 mb-32">
                {/* Logo - only show if no background image is available */}
                {!backgroundImage && (
                  <div className="mb-8">
                    <img 
                      src="/logo_light.svg" 
                      alt="Wingman Chat" 
                      className="h-24 w-24 opacity-70 dark:hidden"
                    />
                    <img 
                      src="/logo_dark.svg" 
                      alt="Wingman Chat" 
                      className="h-24 w-24 opacity-70 hidden dark:block"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="flex-1 overflow-auto transition-opacity duration-300 relative"
              ref={containerRef}
            >
              <div className={`px-3 pt-18 transition-all duration-150 ease-out ${
                layoutMode === 'wide'
                  ? 'max-w-full md:max-w-[80vw] mx-auto' 
                  : 'max-content-width'
              }`} style={{ paddingBottom: `${chatInputHeight}px` }}>
                <Disclaimer />
                
                {messages.map((message, idx) => (
                  <ChatMessage key={idx} index={idx} message={message} isLast={idx === messages.length - 1} isResponding={isResponding} />
                ))}
                
                {/* sentinel for scrollIntoView */}
                <div ref={bottomRef} />
              </div>
            </div>
          )}

          {/* Jump to latest button - positioned relative to chat area */}
          {messages.length > 0 && !isAutoScrollEnabled && (
            <div className={`fixed flex justify-center pointer-events-none z-10 transition-all duration-300 ease-out ${
              showAppDrawer ? 'left-0 right-[calc(66vw+0.75rem)]' :
              showArtifactsDrawer ? 'left-0 right-[calc(66vw+0.75rem)]' :
              showRepositoryDrawer ? 'left-0 right-83' : 'left-0 right-0'
            }`} style={{ bottom: `${chatInputHeight + 16}px` }}>
              <button
                type="button"
                onClick={enableAutoScroll}
                className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 dark:bg-neutral-800/90 text-neutral-700 dark:text-neutral-300 p-2 shadow-md border border-neutral-200/50 dark:border-neutral-700/50 hover:bg-white dark:hover:bg-neutral-800 hover:shadow-lg transition-all backdrop-blur-sm"
                aria-label="Scroll to bottom"
              >
                <ArrowDown size={16} />
              </button>
            </div>
          )}
        </main>

        {/* Chat Input */}
        <footer className={`fixed bottom-0 left-0 md:px-3 md:pb-4 pointer-events-none z-20 transition-all duration-500 ease-in-out ${
            messages.length === 0 && !showArtifactsDrawer && !showAppDrawer ? 'md:bottom-1/3 md:transform md:translate-y-1/2' : ''
          } ${
            showSidebar && chats.length > 0 && !showArtifactsDrawer && !showRepositoryDrawer && !showAppDrawer ? 'md:left-59' : ''
          } ${
            showAppDrawer ? 'right-0 md:right-[calc(66vw+0.75rem)]' :
            showArtifactsDrawer ? 'right-0 md:right-[calc(66vw+0.75rem)]' :
            showRepositoryDrawer ? 'right-0 md:right-83' : 'right-0'
          }`}>
            <div className="relative pointer-events-auto md:max-w-4xl mx-auto">
              <ChatInput />
            </div>
          </footer>

      </div>

      {/* Artifacts drawer - right side */}
      {shouldRenderArtifactsDrawer && (
        <div 
          className={`w-full transition-all duration-300 ease-out transform ${
            isArtifactsDrawerAnimating 
              ? 'translate-x-0 opacity-100' 
              : 'translate-x-full opacity-0'
          } ${ 
            // On mobile: full width overlay from right edge, on desktop: positioned with right edge and 66% width
            'fixed right-0 md:right-3 md:top-18 md:bottom-4 md:w-[66vw] max-w-none'
          } ${shouldRenderRepositoryDrawer ? 'z-20' : 'z-25'}`}
          style={{ 
            top: isMobile ? '48px' : undefined,
            bottom: isMobile ? `${chatInputHeight - 16}px` : undefined
          }}
        >
          <div className="h-full md:rounded-lg md:border md:border-neutral-200/60 md:dark:border-neutral-700/60 md:shadow-sm overflow-hidden">
            <ArtifactsDrawer />
          </div>
        </div>
      )}

      {/* Repository drawer - right side - renders over artifacts when both are visible */}
      {repositoryAvailable && shouldRenderRepositoryDrawer && (
        <div 
          className={`w-full z-25 transition-all duration-150 ease-linear transform ${
            isRepositoryDrawerAnimating 
              ? 'translate-x-0 opacity-100' 
              : 'translate-x-full opacity-0'
          } ${ 
            // On mobile: full width overlay from right edge, on desktop: 20rem width
            'fixed right-0 md:right-3 md:top-18 md:bottom-4 md:w-80'
          }`}
          style={{ 
            top: isMobile ? '48px' : undefined,
            bottom: isMobile ? `${chatInputHeight - 16}px` : undefined
          }}
        >
          <RepositoryDrawer />
        </div>
      )}

      {/* App drawer - right side - for MCP tool UIs */}
      {/* Always render so iframe is available, but hide when not active */}
      <div 
        className={`w-full transition-all duration-300 ease-out transform ${
          shouldRenderAppDrawer && isAppDrawerAnimating 
            ? 'translate-x-0 opacity-100' 
            : 'translate-x-full opacity-0 pointer-events-none'
        } ${ 
          // On mobile: full width overlay from right edge, on desktop: positioned with right edge and 50% width
          'fixed right-0 md:right-3 md:top-18 md:bottom-4 md:w-[50vw] max-w-none z-30'
        }`}
        style={{ 
          top: isMobile ? '48px' : undefined,
          bottom: isMobile ? `${chatInputHeight - 16}px` : undefined
        }}
      >
        <div className="h-full md:rounded-lg md:border md:border-neutral-200/60 md:dark:border-neutral-700/60 md:shadow-sm overflow-hidden">
          <AppDrawer />
        </div>
      </div>
    </div>
  );
}

export default ChatPage;
