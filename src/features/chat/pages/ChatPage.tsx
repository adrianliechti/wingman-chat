import { useMatch, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  BotMessageSquare,
  ChevronLeft,
  ChevronRight,
  Info,
  Plus as PlusIcon,
  Shapes,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentDrawer } from "@/features/agent/components/AgentDrawer";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { ArtifactsDrawer } from "@/features/artifacts/components/ArtifactsDrawer";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { ChatMessage } from "@/features/chat/components/ChatMessage";
import { ChatSidebar } from "@/features/chat/components/ChatSidebar";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { useChatScroll } from "@/shared";
import { getConfig } from "@/shared/config";
import { sanitizeHtmlToReact } from "@/shared/lib/htmlToReact";
import { AppDrawer } from "@/shell/components/AppDrawer";
import { BackgroundImage } from "@/shell/components/BackgroundImage";
import { useApp } from "@/shell/hooks/useApp";
import { useBackground } from "@/shell/hooks/useBackground";
import { useLayout } from "@/shell/hooks/useLayout";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";

// Custom hook to handle drawer animation state
function useDrawerAnimation(isOpen: boolean) {
  const [isAnimating, setIsAnimating] = useState(isOpen);
  const [shouldRender, setShouldRender] = useState(isOpen);

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
      return config.disclaimer?.trim()
        ? sanitizeHtmlToReact(config.disclaimer, { keyPrefix: "chat-disclaimer" })
        : null;
    } catch {
      return null;
    }
  }, []);

  if (!disclaimer) return null;

  return (
    <div className="mb-6 mx-auto max-w-2xl">
      <div className="flex items-start justify-center gap-2 px-4 py-3">
        <Info size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
        <div className="text-xs text-neutral-600 dark:text-neutral-400 text-left">{disclaimer}</div>
      </div>
    </div>
  );
};

export function ChatPage() {
  const { messages, selectChat, chat, chats, isResponding } = useChat();

  const navigate = useNavigate();
  const { newChat } = useChatNavigate();
  const chatIdMatch = useMatch({ from: "/app/chat/$chatId", shouldThrow: false });
  const routeChatId = chatIdMatch?.params.chatId;

  // Sync URL → state for deep links and browser back/forward navigation.
  // User-initiated actions (plus button, sidebar clicks) go through useChatNavigate
  // which sets both state and URL directly, so this only catches external URL changes.
  useEffect(() => {
    const activeChatId = chat?.id ?? null;

    if (routeChatId && routeChatId !== activeChatId) {
      selectChat(routeChatId);
    } else if (!routeChatId && activeChatId) {
      selectChat(null);
    }
  }, [routeChatId, chat?.id, selectChat]);

  // Sync state → URL when a chat is implicitly created during message send.
  // The URL is still /chat but chatId just appeared — update to /chat/$chatId.
  useEffect(() => {
    const previousChatId = previousChatIdRef.current;
    const currentChatId = chat?.id ?? null;

    if (currentChatId && !routeChatId && previousChatId === null) {
      navigate({ to: "/chat/$chatId", params: { chatId: currentChatId }, replace: true });
    }

    previousChatIdRef.current = currentChatId;
  }, [chat?.id, navigate, routeChatId]);

  const { layoutMode } = useLayout();
  const { isAvailable: artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer } = useArtifacts();
  const { showAgentDrawer, toggleAgentDrawer } = useAgents();
  const { showAppDrawer, closeApp } = useApp();

  // Only need backgroundImage to check if background should be shown
  const { backgroundImage } = useBackground();

  // Drawer animation states using custom hook
  const { isAnimating: isAgentDrawerAnimating, shouldRender: shouldRenderAgentDrawer } =
    useDrawerAnimation(showAgentDrawer);
  const { isAnimating: isArtifactsDrawerAnimating, shouldRender: shouldRenderArtifactsDrawer } =
    useDrawerAnimation(showArtifactsDrawer);
  const { isAnimating: isAppDrawerAnimating, shouldRender: shouldRenderAppDrawer } = useDrawerAnimation(showAppDrawer);

  // Track if we're on mobile for drawer positioning
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);

  // Sidebar integration (now only controls visibility)
  const { setSidebarContent, showSidebar } = useSidebar();
  const { setRightActions } = useNavigation();

  // Ref to track chat input height for dynamic padding
  const [chatInputHeight, setChatInputHeight] = useState(112); // Default to pb-28 (7rem = 112px)
  const messageKeysRef = useRef<string[]>([]);
  const messageKeyScopeRef = useRef<string | null>(null);
  const nextMessageKeyRef = useRef(0);
  const previousChatIdRef = useRef<string | null>(null);

  const messageRenderKeys = useMemo(() => {
    const scopeKey = chat?.id ?? routeChatId ?? "__draft__";

    if (messageKeyScopeRef.current !== scopeKey) {
      messageKeysRef.current = [];
      nextMessageKeyRef.current = 0;
      messageKeyScopeRef.current = scopeKey;
    }

    if (messageKeysRef.current.length > messages.length) {
      messageKeysRef.current.length = messages.length;
    }

    while (messageKeysRef.current.length < messages.length) {
      messageKeysRef.current.push(`${scopeKey}-message-${nextMessageKeyRef.current}`);
      nextMessageKeyRef.current += 1;
    }

    return messageKeysRef.current.slice(0, messages.length);
  }, [chat?.id, messages.length, routeChatId]);

  const { handleScrollContainerRef, handleSpacerRef, isAtBottom, goToLatest } = useChatScroll({
    resetKey: chat?.id ?? routeChatId ?? "__draft__",
    messages,
    isResponding,
  });

  // Track window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Set up navigation actions
  useEffect(() => {
    setRightActions(
      <div className="flex items-center gap-2">
        {artifactsAvailable && (
          <button
            type="button"
            className={`p-2 rounded transition-all duration-150 ease-out ${showArtifactsDrawer ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
            onClick={toggleArtifactsDrawer}
            title={showArtifactsDrawer ? "Close artifacts" : "Open artifacts"}
          >
            <Shapes size={20} />
          </button>
        )}
        <button
          type="button"
          className={`p-2 rounded transition-all duration-150 ease-out ${showAgentDrawer ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
          onClick={toggleAgentDrawer}
          title={showAgentDrawer ? "Close agent" : "Open agent"}
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
      </div>,
    );

    return () => {
      setRightActions(null);
    };
  }, [
    setRightActions,
    newChat,
    artifactsAvailable,
    showArtifactsDrawer,
    toggleArtifactsDrawer,
    showAgentDrawer,
    toggleAgentDrawer,
  ]);

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
    const element = footerElementRef.current ?? document.querySelector("footer");
    if (element) {
      footerElementRef.current = element;
      const height = element.getBoundingClientRect().height;
      setChatInputHeight(height + 24);
    }
  }, []);

  // Measure footer height synchronously on mount so that the initial
  // scroll-to-bottom on direct URL loads uses the correct paddingBottom.
  // The async 100ms measurement below fires too late when messages are cached.
  useLayoutEffect(() => {
    observeHeight();
  }, [observeHeight]);

  // Observer for chat input height changes to adjust message container padding
  useEffect(() => {
    // Fallback measurement after a short delay in case the layout effect fired
    // before fonts/styles were fully applied (rare, but keeps the observer setup).
    const timer = setTimeout(observeHeight, 100);

    // Create a MutationObserver to watch for changes in the footer area
    const mutationObserver = new MutationObserver(observeHeight);

    // Use ResizeObserver to watch for height changes
    const resizeObserver = new ResizeObserver(observeHeight);

    // Start observing once the fixed footer element exists
    const startObserving = () => {
      const footerElement = document.querySelector("footer");
      if (footerElement) {
        footerElementRef.current = footerElement as HTMLElement;
        resizeObserver.observe(footerElement);
        mutationObserver.observe(footerElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      } else {
        // If footer doesn't exist yet, try again after a short delay
        setTimeout(startObserving, 50);
      }
    };

    startObserving();

    // Also listen for window resize as a fallback
    window.addEventListener("resize", observeHeight);

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", observeHeight);
    };
  }, [observeHeight]);

  return (
    <div className="h-full w-full flex overflow-hidden relative">
      <BackgroundImage opacity={messages.length === 0 ? 80 : 0} />

      {/* Main content area */}
      <div
        className={`flex-1 flex flex-col overflow-hidden relative transition-all duration-500 ease-in-out ${
          showAppDrawer
            ? "md:mr-[calc(50vw+0.75rem)]"
            : showArtifactsDrawer
              ? "md:mr-[calc(66vw+0.75rem)]"
              : showAgentDrawer
                ? "md:mr-83"
                : ""
        }`}
      >
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center pt-16 relative">
              <div className="flex flex-col items-center text-center relative z-10 w-full max-w-4xl px-4 mb-32">
                {/* Logo - only show if no background image is available */}
                {!backgroundImage && (
                  <div className="mb-8">
                    <img src="/logo_light.svg" alt="Wingman Chat" className="h-24 w-24 opacity-70 dark:hidden" />
                    <img src="/logo_dark.svg" alt="Wingman Chat" className="h-24 w-24 opacity-70 hidden dark:block" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="flex-1 overflow-auto transition-opacity duration-300 relative"
              ref={handleScrollContainerRef}
            >
              <div
                className={`px-3 pt-18 transition-[max-width] duration-150 ease-out ${layoutMode === "wide" ? "max-w-full md:max-w-[80vw] mx-auto" : "max-content-width"}`}
                style={{ paddingBottom: chatInputHeight }}
              >
                <Disclaimer />

                <div>
                  {messages.map((message, index) => (
                    <div key={messageRenderKeys[index]} className="flow-root" data-role={message.role}>
                      <ChatMessage
                        index={index}
                        message={message}
                        isLast={index === messages.length - 1}
                        isResponding={isResponding}
                        onGoToLatest={goToLatest}
                      />
                    </div>
                  ))}
                </div>
                {/* Spacer — allows the last user message to scroll to the top */}
                <div ref={handleSpacerRef} aria-hidden="true" />
              </div>
            </div>
          )}

          {messages.length > 0 && !isAtBottom && (
            <button
              type="button"
              onClick={goToLatest}
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
        <footer
          className={`fixed bottom-0 left-0 md:px-3 md:pb-4 pointer-events-none z-20 transition-[left,right] duration-500 ease-in-out ${showSidebar && chats.length > 0 && !showArtifactsDrawer && !showAgentDrawer && !showAppDrawer ? "md:left-59" : ""} ${
            showAppDrawer
              ? "right-0 md:right-[calc(50vw+0.75rem)]"
              : showArtifactsDrawer
                ? "right-0 md:right-[calc(66vw+0.75rem)]"
                : showAgentDrawer
                  ? "right-0 md:right-83"
                  : "right-0"
          }`}
        >
          <div
            className={`relative pointer-events-auto md:max-w-4xl mx-auto transition-transform duration-500 ease-in-out ${
              messages.length === 0 && !showArtifactsDrawer && !showAppDrawer && !showAgentDrawer
                ? "md:translate-y-[calc(50%-33.333vh)]"
                : ""
            }`}
          >
            <ChatInput />
          </div>
        </footer>
      </div>

      {/* Artifacts drawer - right side */}
      {shouldRenderArtifactsDrawer && (
        <div
          className={`w-full transition-all duration-300 ease-out transform ${isArtifactsDrawerAnimating ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"} ${
            // On mobile: full width overlay from right edge, on desktop: positioned with right edge and 66% width
            "fixed right-0 md:right-3 md:top-18 md:bottom-4 md:w-[66vw] max-w-none"
          } ${shouldRenderAgentDrawer ? "z-20" : "z-25"}`}
          style={{
            top: isMobile ? "48px" : undefined,
            bottom: isMobile ? `${chatInputHeight - 16}px` : undefined,
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
          className={`w-full z-25 transition-all duration-150 ease-linear transform ${isAgentDrawerAnimating ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"} ${
            // On mobile: full width overlay from right edge, on desktop: 20rem width
            "fixed right-0 md:right-3 md:top-18 md:bottom-4 md:w-80"
          }`}
          style={{
            top: isMobile ? "48px" : undefined,
            bottom: isMobile ? `${chatInputHeight - 16}px` : undefined,
          }}
        >
          <AgentDrawer />
        </div>
      )}

      {/* App drawer - right side - for MCP tool UIs */}
      {/* Always render so iframe is available, but hide when not active */}
      <div
        className={`w-full transition-all duration-300 ease-out transform ${shouldRenderAppDrawer && isAppDrawerAnimating ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none"} ${
          // On mobile: full width overlay from right edge, on desktop: positioned with right edge and 50% width
          "fixed right-0 md:right-3 md:top-18 md:bottom-4 md:w-[50vw] max-w-none z-30"
        }`}
        style={{
          top: isMobile ? "48px" : undefined,
          bottom: isMobile ? `${chatInputHeight - 16}px` : undefined,
        }}
      >
        <div className="h-full md:rounded-lg md:border md:border-neutral-200/60 md:dark:border-neutral-700/60 md:shadow-sm overflow-hidden flex flex-col">
          {/* Mobile close bar */}
          <div className="flex md:hidden items-center h-10 px-2 border-b border-neutral-200/60 dark:border-neutral-700/60 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => closeApp()}
              className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors p-1.5 rounded"
            >
              <ChevronLeft size={16} />
              <span>Back</span>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <AppDrawer />
          </div>
        </div>
        {/* Flag tab on the left edge to close the drawer */}
        <button
          type="button"
          onClick={() => closeApp()}
          className="hidden md:flex absolute left-0 top-6 -translate-x-full items-center justify-center w-5 h-12 rounded-l-md bg-white/90 dark:bg-neutral-800/90 border border-r-0 border-neutral-200/60 dark:border-neutral-700/60 shadow-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
          title="Close panel"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

export default ChatPage;
