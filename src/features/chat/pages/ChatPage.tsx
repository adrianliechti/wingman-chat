import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus as PlusIcon, BotMessageSquare, Info, Paperclip, Rocket, ArrowDown } from "lucide-react";
import DOMPurify from "dompurify";
import { useNavigate, useMatch } from '@tanstack/react-router';
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { useAutoScroll } from "@/shared";
import { getConfig } from "@/shared/config";
import { useSidebar } from "@/shell/hooks/useSidebar";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useLayout } from "@/shell/hooks/useLayout";
import { useChat } from "@/features/chat/hooks/useChat";
import { useBackground } from "@/shell/hooks/useBackground";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { ChatMessage } from "@/features/chat/components/ChatMessage";
import { ChatSidebar } from "@/features/chat/components/ChatSidebar";
import { BackgroundImage } from "@/shell/components/BackgroundImage";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useApp } from "@/shell/hooks/useApp";
import { AgentDrawer } from "@/features/agent/components/AgentDrawer";
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
    messages,
    selectChat,
    chat,
    chats,
    isResponding,
  } = useChat();

  const navigate = useNavigate();
  const { newChat } = useChatNavigate();
  const chatIdMatch = useMatch({ from: '/app/chat/$chatId', shouldThrow: false });
  const routeChatId = chatIdMatch?.params.chatId;

  // Sync URL → state for deep links and browser back/forward navigation.
  // User-initiated actions (plus button, sidebar clicks) go through useChatNavigate
  // which sets both state and URL directly, so this only catches external URL changes.
  useEffect(() => {
    if (routeChatId && routeChatId !== chat?.id) {
      selectChat(routeChatId);
    } else if (!routeChatId && chat) {
      selectChat(null);
    }
  }, [routeChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync state → URL when a chat is implicitly created during message send.
  // The URL is still /chat but chatId just appeared — update to /chat/$chatId.
  useEffect(() => {
    if (chat?.id && !routeChatId) {
      navigate({ to: '/chat/$chatId', params: { chatId: chat.id }, replace: true });
    }
  }, [chat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { layoutMode } = useLayout();
  const { isAvailable: artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer } = useArtifacts();
  const { showAgentDrawer, toggleAgentDrawer } = useAgents();
  const { showAppDrawer, toggleAppDrawer, hasAppContent } = useApp();
  
  // Only need backgroundImage to check if background should be shown
  const { backgroundImage } = useBackground();
  
  // Drawer animation states using custom hook
  const { isAnimating: isAgentDrawerAnimating, shouldRender: shouldRenderAgentDrawer } = useDrawerAnimation(showAgentDrawer);
  const { isAnimating: isArtifactsDrawerAnimating, shouldRender: shouldRenderArtifactsDrawer } = useDrawerAnimation(showArtifactsDrawer);
  const { isAnimating: isAppDrawerAnimating, shouldRender: shouldRenderAppDrawer } = useDrawerAnimation(showAppDrawer);
  
  // Track if we're on mobile for drawer positioning
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  
  // Sidebar integration (now only controls visibility)
  const { setSidebarContent, showSidebar } = useSidebar();
  const { setRightActions } = useNavigation();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  // Ref to track chat input height for dynamic padding
  const [chatInputHeight, setChatInputHeight] = useState(112); // Default to pb-28 (7rem = 112px)

  // Virtualizer for chat messages – the +1 adds a zero-height sentinel at the
  // end of the list so scrollToIndex always has a stable, measurement-free target.
  const virtualizer = useVirtualizer({
    count: messages.length + 1,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (i) => (i < messages.length ? 120 : 0),
    paddingEnd: chatInputHeight,
    scrollPaddingEnd: chatInputHeight,
    overscan: 10,
  });

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const previousMessageCountRef = useRef(messages.length);

  const { enableAutoScroll, isAutoScrollEnabled } = useAutoScroll({
    scrollElement,
    virtualizer,
  });

  const handleScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element;
    setScrollElement(element);
  }, []);

  // Re-enable auto-scroll when the user sends a new message while scrolled up.
  useEffect(() => {
    const prev = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    if (messages.length > prev && messages[messages.length - 1]?.role === 'user') {
      enableAutoScroll();
    }
  }, [messages, enableAutoScroll]);

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
        {artifactsAvailable && (
          <button
            type="button"
            className={`p-2 rounded transition-all duration-150 ease-out ${showArtifactsDrawer ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
            onClick={toggleArtifactsDrawer}
            title={showArtifactsDrawer ? 'Close artifacts' : 'Open artifacts'}
          >
            <Paperclip size={20} />
          </button>
        )}
        <button
          type="button"
          className={`p-2 rounded transition-all duration-150 ease-out ${showAgentDrawer ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
          onClick={toggleAgentDrawer}
          title={showAgentDrawer ? 'Close agent' : 'Open agent'}
        >
          <BotMessageSquare size={20} />
        </button>
        <button
          type="button"
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
          onClick={newChat}
        >
          <PlusIcon size={20} />
        </button>
      </div>
    );

    return () => {
      setRightActions(null);
    };
  }, [setRightActions, newChat, artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer, showAgentDrawer, toggleAgentDrawer, hasAppContent, showAppDrawer, toggleAppDrawer]);

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

  // Ref to cache the fixed footer element
  const footerElementRef = useRef<HTMLElement | null>(null);

  // Memoized height observer callback
  const observeHeight = useCallback(() => {
    const element = footerElementRef.current ?? document.querySelector('footer');
    if (element) {
      footerElementRef.current = element;
      const height = element.getBoundingClientRect().height;
      setChatInputHeight(height + 24);
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

    // Start observing once the fixed footer element exists
    const startObserving = () => {
      const footerElement = document.querySelector('footer');
      if (footerElement) {
        footerElementRef.current = footerElement as HTMLElement;
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
        showAppDrawer ? 'md:mr-[calc(50vw+0.75rem)]' :
        showArtifactsDrawer ? 'md:mr-[calc(66vw+0.75rem)]' : 
        showAgentDrawer ? 'md:mr-83' : ''
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
              style={{ overflowAnchor: 'none' }}
              ref={handleScrollContainerRef}
            >
              <div className={`px-3 pt-18 transition-all duration-150 ease-out ${
                layoutMode === 'wide'
                  ? 'max-w-full md:max-w-[80vw] mx-auto' 
                  : 'max-content-width'
              }`}>
                <Disclaimer />
                
                {/* Virtualized message list */}
                <div style={{ height: totalSize, width: '100%', position: 'relative' }}>
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                  }}>
                    {virtualItems.map((virtualRow) =>
                      virtualRow.index < messages.length ? (
                        <div
                          key={virtualRow.key}
                          data-index={virtualRow.index}
                          ref={virtualizer.measureElement}
                          className="flow-root"
                        >
                          <ChatMessage
                            index={virtualRow.index}
                            message={messages[virtualRow.index]}
                            isLast={virtualRow.index === messages.length - 1}
                            isResponding={isResponding}
                          />
                        </div>
                      ) : (
                        <div key="__sentinel" data-index={virtualRow.index} ref={virtualizer.measureElement} />
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {messages.length > 0 && !isAutoScrollEnabled && (
            <button
              type="button"
              onClick={enableAutoScroll}
              className="absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-neutral-200/80 bg-white/95 px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm backdrop-blur transition-colors hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-700/80 dark:bg-neutral-900/95 dark:text-neutral-200 dark:hover:border-neutral-600 dark:hover:text-neutral-50"
              style={{ bottom: chatInputHeight + 16 }}
              title="Jump to latest"
            >
              <ArrowDown size={16} />
              <span>Latest</span>
            </button>
          )}

        </main>

        {/* Chat Input */}
        <footer className={`fixed bottom-0 left-0 md:px-3 md:pb-4 pointer-events-none z-20 transition-all duration-500 ease-in-out ${
            messages.length === 0 && !showArtifactsDrawer && !showAppDrawer && !showAgentDrawer ? 'md:bottom-1/3 md:transform md:translate-y-1/2' : ''
          } ${
            showSidebar && chats.length > 0 && !showArtifactsDrawer && !showAgentDrawer && !showAppDrawer ? 'md:left-59' : ''
          } ${
            showAppDrawer ? 'right-0 md:right-[calc(50vw+0.75rem)]' :
            showArtifactsDrawer ? 'right-0 md:right-[calc(66vw+0.75rem)]' :
            showAgentDrawer ? 'right-0 md:right-83' : 'right-0'
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
          } ${shouldRenderAgentDrawer ? 'z-20' : 'z-25'}`}
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

      {/* Agent drawer - right side - renders over artifacts when both are visible */}
      {shouldRenderAgentDrawer && (
        <div 
          className={`w-full z-25 transition-all duration-150 ease-linear transform ${
            isAgentDrawerAnimating 
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
          <AgentDrawer />
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
