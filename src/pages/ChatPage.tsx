import { useEffect, useMemo, useState } from "react";
import { Plus as PlusIcon, Package, PackageOpen, Info, ArrowDown, BookOpenText, BookText } from "lucide-react";
import DOMPurify from "dompurify";
import { getConfig } from "../config";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { useSidebar } from "../hooks/useSidebar";
import { useNavigation } from "../hooks/useNavigation";
import { useLayout } from "../hooks/useLayout";
import { useChat } from "../hooks/useChat";
import { useBackground } from "../hooks/useBackground";
import { ChatInput } from "../components/ChatInput";
import { ChatMessage } from "../components/ChatMessage";
import { ChatSidebar } from "../components/ChatSidebar";
import { BackgroundImage } from "../components/BackgroundImage";
import { useRepositories } from "../hooks/useRepositories";
import { useArtifacts } from "../hooks/useArtifacts";
import { RepositoryDrawer } from "../components/RepositoryDrawer";
import { ArtifactsDrawer } from "../components/ArtifactsDrawer";

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
  
  // Only need backgroundImage to check if background should be shown
  const { backgroundImage } = useBackground();
  
  // Repository drawer state
  const [isRepositoryDrawerAnimating, setIsRepositoryDrawerAnimating] = useState(false);
  const [isArtifactsDrawerAnimating, setIsArtifactsDrawerAnimating] = useState(false);
  const [shouldRenderRepositoryDrawer, setShouldRenderRepositoryDrawer] = useState(false);
  const [shouldRenderArtifactsDrawer, setShouldRenderArtifactsDrawer] = useState(false);
  
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
  }, [setRightActions, createChat, artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer, repositoryAvailable, showRepositoryDrawer, toggleRepositoryDrawer]);

  // Handle repository drawer animation
  useEffect(() => {
    if (showRepositoryDrawer) {
      // Small delay to ensure the element is in the DOM before animating
      queueMicrotask(() => {
        setShouldRenderRepositoryDrawer(true);
      });
      setTimeout(() => {
        setIsRepositoryDrawerAnimating(true);
      }, 10);
    } else {
      queueMicrotask(() => {
        setIsRepositoryDrawerAnimating(false);
      });
      // Remove from DOM after animation completes
      const timer = setTimeout(() => {
        setShouldRenderRepositoryDrawer(false);
      }, 300); // Match the transition duration
      return () => clearTimeout(timer);
    }
  }, [showRepositoryDrawer]);

  // Handle artifacts drawer animation
  useEffect(() => {
    if (showArtifactsDrawer) {
      // Small delay to ensure the element is in the DOM before animating
      queueMicrotask(() => {
        setShouldRenderArtifactsDrawer(true);
      });
      setTimeout(() => {
        setIsArtifactsDrawerAnimating(true);
      }, 10);
    } else {
      queueMicrotask(() => {
        setIsArtifactsDrawerAnimating(false);
      });
      // Remove from DOM after animation completes
      const timer = setTimeout(() => {
        setShouldRenderArtifactsDrawer(false);
      }, 300); // Match the transition duration
      return () => clearTimeout(timer);
    }
  }, [showArtifactsDrawer]);

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

  // Observer for chat input height changes to adjust message container padding
  useEffect(() => {
    const observeHeight = () => {
      // Find the chat input container by looking for the form element in the footer
      const footerElement = document.querySelector('footer form');
      if (footerElement) {
        // Get the actual height of the chat input container
        const height = footerElement.getBoundingClientRect().height;
        // Add some extra padding (16px) for breathing room
        setChatInputHeight(height + 16);
      }
    };

    // Initial measurement after a short delay to ensure DOM is ready
    const timer = setTimeout(observeHeight, 100);

    // Create a MutationObserver to watch for changes in the footer area
    const mutationObserver = new MutationObserver(() => {
      observeHeight();
    });

    // Use ResizeObserver to watch for height changes
    const resizeObserver = new ResizeObserver(observeHeight);

    // Start observing once the footer element exists
    const startObserving = () => {
      const footerElement = document.querySelector('footer form');
      if (footerElement) {
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
  }, []);

  return (
    <div className="h-full w-full flex overflow-hidden relative">
      <BackgroundImage opacity={messages.length === 0 ? 80 : 0} />
      
      {/* Main content area */}
      <div className={`flex-1 flex flex-col overflow-hidden relative transition-all duration-300 ${
        showArtifactsDrawer ? 'md:mr-[calc(50vw+0.75rem)]' : 
        showRepositoryDrawer ? 'md:mr-[calc(20rem+0.75rem)]' : ''
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
                {(() => {
                  try {
                    const config = getConfig();
                    const disclaimer = DOMPurify.sanitize(config.disclaimer);
                    if (disclaimer && disclaimer.trim()) {
                      return (
                        <div className="mb-6 mx-auto max-w-2xl">
                          <div className="flex items-start justify-center gap-2 px-4 py-3">
                            <Info size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
                            <p className="text-xs text-neutral-600 dark:text-neutral-400 text-left"
                              dangerouslySetInnerHTML={{ __html: disclaimer }}
                            />
                          </div>
                        </div>
                      );
                    }
                    return null;
                  } catch {
                    return null;
                  }
                })()}
                
                {messages.map((message, idx) => (
                  <ChatMessage key={idx} message={message} isLast={idx === messages.length - 1} isResponding={isResponding} />
                ))}
                
                {/* sentinel for scrollIntoView */}
                <div ref={bottomRef} />
              </div>
            </div>
          )}

          {/* Jump to latest button - positioned relative to chat area */}
          {messages.length > 0 && !isAutoScrollEnabled && (
            <div className={`fixed flex justify-center pointer-events-none z-10 transition-all duration-300 ease-out ${
              showArtifactsDrawer ? 'left-0 right-[calc(50vw+0.75rem)]' :
              showRepositoryDrawer ? 'left-0 right-[calc(20rem+0.75rem)]' : 'left-0 right-0'
            }`} style={{ bottom: `${chatInputHeight + 16}px` }}>
              <button
                type="button"
                onClick={enableAutoScroll}
                className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 dark:bg-neutral-800/90 text-neutral-700 dark:text-neutral-300 p-2 shadow-md border border-neutral-200/50 dark:border-neutral-700/50 hover:bg-white dark:hover:bg-neutral-800 hover:shadow-lg transition-all backdrop-blur-sm cursor-pointer"
                aria-label="Scroll to bottom"
              >
                <ArrowDown size={16} />
              </button>
            </div>
          )}
        </main>

        {/* Chat Input */}
        <footer className={`fixed bottom-0 left-0 md:px-3 md:pb-4 pointer-events-none z-20 transition-all duration-500 ease-in-out ${
            messages.length === 0 ? 'md:bottom-1/3 md:transform md:translate-y-1/2' : ''
          } ${
            showSidebar && chats.length > 0 ? 'md:left-[calc(14rem+0.75rem)]' : ''
          } ${
            showArtifactsDrawer ? 'right-0 md:right-[calc(50vw+0.75rem)]' :
            showRepositoryDrawer ? 'right-0 md:right-[calc(20rem+0.75rem)]' : 'right-0'
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
            // On mobile: full width overlay from right edge, on desktop: positioned with right edge and 60% width
            'fixed right-0 md:right-3 md:top-18 md:bottom-4 md:w-[50vw] max-w-none'
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
    </div>
  );
}

export default ChatPage;
