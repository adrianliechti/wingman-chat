import { useMatch, useNavigate } from "@tanstack/react-router";
import { AppWindow, ArrowDown, ChevronLeft, Info, Plus as PlusIcon, Shapes } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentDrawer } from "@/features/agent/components/AgentDrawer";
import { SkillCatalog } from "@/features/agent/components/SkillCatalog";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { ArtifactsDrawer } from "@/features/artifacts/components/ArtifactsDrawer";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { AgentButton } from "@/features/chat/components/AgentButton";
import { ChatConsentBackdrop, ChatConsentBanner } from "@/features/chat/components/ChatConsentOverlay";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { ChatMessage } from "@/features/chat/components/ChatMessage";
import { ChatSidebar } from "@/features/chat/components/ChatSidebar";
import { ChatToolGroup } from "@/features/chat/components/ChatToolGroup";
import { groupRenderUnits } from "@/features/chat/components/chatMessageUtils";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { useDrawerAnimation } from "@/features/chat/hooks/useDrawerAnimation";
import { useDrawerExclusivity } from "@/features/chat/hooks/useDrawerExclusivity";
import { useDrawerResize } from "@/features/chat/hooks/useDrawerResize";
import { getSavedModelId } from "@/features/chat/hooks/useModels";
import { useSkills } from "@/features/skills/hooks/useSkills";
import type { Skill } from "@/features/skills/lib/skillParser";
import { useVoice } from "@/features/voice/hooks/useVoice";
import { useChatScroll } from "@/shared";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { sanitizeHtmlToReact } from "@/shared/lib/htmlToReact";
import { AppDrawer } from "@/shell/components/AppDrawer";
import { BackgroundImage } from "@/shell/components/BackgroundImage";
import { useApp } from "@/shell/hooks/useApp";
import { useBackground } from "@/shell/hooks/useBackground";
import { useLayout } from "@/shell/hooks/useLayout";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";

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
  const { messages, selectChat, chat, chats, chatsLoaded, isResponding, model, models, setModel } = useChat();
  const { isListening, stopVoice } = useVoice();

  const navigate = useNavigate();
  const { newChat } = useChatNavigate();

  const handleNewChat = useCallback(() => {
    if (model?.id === "realtime") {
      const savedId = getSavedModelId();
      const restored = (savedId && models.find((m) => m.id === savedId)) || models[0];
      setModel(restored ?? null);
    }
    if (isListening) {
      stopVoice();
    }
    newChat();
  }, [model, models, setModel, isListening, stopVoice, newChat]);
  const chatIdMatch = useMatch({ from: "/app/chat/$chatId", shouldThrow: false });
  const routeChatId = chatIdMatch?.params.chatId;

  // Sync URL → state for deep links and browser back/forward navigation.
  // User-initiated actions (plus button, sidebar clicks) go through useChatNavigate
  // which sets both state and URL directly, so this only catches external URL changes.
  useEffect(() => {
    const activeChatId = chat?.id ?? null;

    if (routeChatId && routeChatId !== activeChatId) {
      // Only select the chat once chats have loaded from storage — otherwise we might
      // redirect away from a valid chat that hasn't been read from OPFS yet.
      if (!chatsLoaded) return;

      const chatExists = chats.some((c) => c.id === routeChatId);
      if (chatExists) {
        selectChat(routeChatId);
      } else {
        // The chat ID in the URL doesn't exist — redirect to new chat
        navigate({ to: "/chat", replace: true });
      }
    } else if (!routeChatId && activeChatId) {
      // Only reset when the route previously had a chatId (explicit navigation away).
      // If undefined, this is a transient render during implicit chat creation.
      if (previousRouteChatIdRef.current !== undefined) {
        selectChat(null);
      }
    }

    previousRouteChatIdRef.current = routeChatId;
  }, [routeChatId, chat?.id, selectChat, chats, chatsLoaded, navigate]);

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
  const {
    isAvailable: artifactsAvailable,
    showArtifactsDrawer,
    toggleArtifactsDrawer,
    setShowArtifactsDrawer,
  } = useArtifacts();
  const { agents, currentAgent, updateAgent, showAgentDrawer, setShowAgentDrawer } = useAgents();
  const { showSkillCatalog, skillCatalogTarget, skillCatalogReadOnly, closeSkillCatalog } = useSkills();

  const agentSkillIds = useMemo(() => new Set(currentAgent?.skills ?? []), [currentAgent]);

  const handleSkillToggle = useCallback(
    (skillName: string) => {
      if (!currentAgent) return;
      const current = currentAgent.skills ?? [];
      const next = current.includes(skillName) ? current.filter((n) => n !== skillName) : [...current, skillName];
      updateAgent(currentAgent.id, { skills: next });
    },
    [currentAgent, updateAgent],
  );

  const handleSkillSaved = useCallback(
    (skill: Skill, isNew: boolean, oldName?: string) => {
      if (isNew && currentAgent) {
        updateAgent(currentAgent.id, { skills: [...(currentAgent.skills ?? []), skill.name] });
      } else if (oldName) {
        for (const a of agents) {
          if (a.skills?.includes(oldName)) {
            updateAgent(a.id, { skills: a.skills.map((n) => (n === oldName ? skill.name : n)) });
          }
        }
      }
    },
    [currentAgent, agents, updateAgent],
  );

  const handleSkillImported = useCallback(
    (names: string[]) => {
      if (!currentAgent) return;
      updateAgent(currentAgent.id, { skills: [...(currentAgent.skills ?? []), ...names] });
    },
    [currentAgent, updateAgent],
  );
  const { showAppDrawer, hasAppContent, toggleAppDrawer, setShowAppDrawer } = useApp();

  // Mutual exclusivity: closing one drawer when another opens
  useDrawerExclusivity({
    showApp: showAppDrawer,
    setShowApp: setShowAppDrawer,
    showArtifacts: showArtifactsDrawer,
    setShowArtifacts: setShowArtifactsDrawer,
    showAgent: showAgentDrawer,
    setShowAgent: setShowAgentDrawer,
  });

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

  // Drawer resize state — each hook owns widthVw + isResizing + the mousedown handler.
  // getSiblingOffsetPx is called once at drag-start to snapshot the combined sibling offset.
  const {
    widthVw: agentWidthVw,
    setWidthVw: setAgentWidthVw,
    isResizing: isAgentResizing,
    handleMouseDown: handleAgentResizeMouseDown,
  } = useDrawerResize({
    defaultWidthVw: 22,
    closeThresholdPx: 200,
    minPanelPx: 280,
    maxPanelPx: 500,
    getSiblingOffsetPx: () =>
      showArtifactsDrawer
        ? (artifactsWidthVw / 100) * window.innerWidth + 12
        : showAppDrawer
          ? (appWidthVw / 100) * window.innerWidth + 12
          : 0,
    setShow: setShowAgentDrawer,
  });

  const {
    widthVw: appWidthVw,
    setWidthVw: setAppWidthVw,
    isResizing: isAppResizing,
    handleMouseDown: handleAppResizeMouseDown,
  } = useDrawerResize({
    defaultWidthVw: 50,
    closeThresholdPx: 120,
    getSiblingOffsetPx: () => (showAgentDrawer ? (agentWidthVw / 100) * window.innerWidth + 12 : 0),
    setShow: setShowAppDrawer,
  });

  const {
    widthVw: artifactsWidthVw,
    setWidthVw: setArtifactsWidthVw,
    isResizing: isArtifactsResizing,
    handleMouseDown: handleArtifactsResizeMouseDown,
  } = useDrawerResize({
    defaultWidthVw: 50,
    closeThresholdPx: 220,
    minPanelPx: 360,
    getSiblingOffsetPx: () => (showAgentDrawer ? (agentWidthVw / 100) * window.innerWidth + 12 : 0),
    setShow: setShowArtifactsDrawer,
  });

  // When agent and a sibling panel (artifacts or app) are both open on desktop,
  // ensure the chat area stays at or above its 400px minimum by clamping both
  // the agent width and the sibling width as needed.
  useEffect(() => {
    const siblingOpen = showArtifactsDrawer || showAppDrawer;
    if (!showAgentDrawer || !siblingOpen || window.innerWidth < 768) return;
    const vw = window.innerWidth;
    const minChatPx = 400;
    const MIN_AGENT_PX = 280;
    const MAX_AGENT_PX = 500;
    // combined gap: 0.75rem (sibling) + 0.75rem (agent) = 1.5rem ≈ 24px
    const gapPx = 24;
    const agentPx = (agentWidthVw / 100) * vw;
    const siblingWidthVw = showAppDrawer ? appWidthVw : artifactsWidthVw;
    const setSiblingWidthVw = showAppDrawer ? setAppWidthVw : setArtifactsWidthVw;
    const siblingPx = (siblingWidthVw / 100) * vw;

    const totalUsed = agentPx + siblingPx + gapPx;
    const available = vw - minChatPx;

    if (totalUsed > available) {
      // First try to shrink agent down to its minimum
      const agentTarget = Math.min(MAX_AGENT_PX, Math.max(MIN_AGENT_PX, agentPx));
      const remainingForSibling = available - agentTarget - gapPx;

      if (remainingForSibling < siblingPx) {
        // Sibling needs to shrink too
        setSiblingWidthVw((Math.max(0, remainingForSibling) / vw) * 100);
      }
      if (agentPx > agentTarget) {
        setAgentWidthVw((agentTarget / vw) * 100);
      }
    }
  }, [
    showArtifactsDrawer,
    showAppDrawer,
    showAgentDrawer,
    agentWidthVw,
    artifactsWidthVw,
    appWidthVw,
    setAgentWidthVw,
    setArtifactsWidthVw,
    setAppWidthVw,
  ]);

  // When agent and a sibling panel (artifacts or app) are both open on desktop,
  // clamp the agent width so the chat area stays at or above its 400px minimum.
  useEffect(() => {
    const siblingOpen = showArtifactsDrawer || showAppDrawer;
    if (!showAgentDrawer || !siblingOpen || window.innerWidth < 768) return;
    const vw = window.innerWidth;
    const minChatPx = 400;
    const MIN_AGENT_PX = 280;
    const MAX_AGENT_PX = 500;
    const siblingWidthVw = showAppDrawer ? appWidthVw : artifactsWidthVw;
    const siblingPx = (siblingWidthVw / 100) * vw;
    // combined gap: 0.75rem (sibling) + 0.75rem (agent) = 1.5rem ≈ 24px
    const gapPx = 24;
    const maxAgentPx = vw - minChatPx - siblingPx - gapPx;
    const currentAgentPx = (agentWidthVw / 100) * vw;
    if (currentAgentPx > maxAgentPx) {
      const clampedPx = Math.min(MAX_AGENT_PX, Math.max(MIN_AGENT_PX, maxAgentPx));
      setAgentWidthVw((clampedPx / vw) * 100);
    }
  }, [
    showArtifactsDrawer,
    showAppDrawer,
    showAgentDrawer,
    agentWidthVw,
    artifactsWidthVw,
    appWidthVw,
    setAgentWidthVw,
  ]);

  // Sidebar integration (now only controls visibility)
  const { setSidebarContent, showSidebar } = useSidebar();
  const { setRightActions } = useNavigation();

  // Ref to track chat input height for dynamic padding
  const [chatInputHeight, setChatInputHeight] = useState(112); // Default to pb-28 (7rem = 112px)
  const messageKeysRef = useRef<string[]>([]);
  const messageKeyScopeRef = useRef<string | null>(null);
  const nextMessageKeyRef = useRef(0);
  const previousChatIdRef = useRef<string | null>(null);
  // Tracks the previous *route* chatId (from the URL). Used to distinguish a
  // genuine user navigation away from a chat from a transient router render
  // that occurs while an implicit chat creation navigates to /chat/$chatId.
  // Previous route chatId — distinguishes real navigation from implicit-creation renders
  const previousRouteChatIdRef = useRef<string | undefined>(undefined);

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

  // Fold runs of consecutive tool results into collapsible groups so tool-heavy
  // turns read as one tidy "Used N tools" row instead of a scattered stack.
  const renderUnits = useMemo(() => groupRenderUnits(messages, isResponding), [messages, isResponding]);

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
        {hasAppContent && (
          <button
            type="button"
            className={cn(
              "p-2 rounded-full transition-all duration-150 ease-out",
              showAppDrawer
                ? "text-neutral-900 dark:text-neutral-100 bg-neutral-200 dark:bg-neutral-700/60"
                : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
            )}
            onClick={toggleAppDrawer}
            title={showAppDrawer ? "Close app" : "Open app"}
          >
            <AppWindow size={20} />
          </button>
        )}
        {artifactsAvailable && (
          <button
            type="button"
            className={cn(
              "p-2 rounded-full transition-all duration-150 ease-out",
              showArtifactsDrawer
                ? "text-neutral-900 dark:text-neutral-100 bg-neutral-200 dark:bg-neutral-700/60"
                : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
            )}
            onClick={toggleArtifactsDrawer}
            title={showArtifactsDrawer ? "Close artifacts" : "Open artifacts"}
          >
            <Shapes size={20} />
          </button>
        )}
        <AgentButton />
        <button
          type="button"
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
          onClick={handleNewChat}
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
    handleNewChat,
    artifactsAvailable,
    showArtifactsDrawer,
    toggleArtifactsDrawer,
    showAppDrawer,
    hasAppContent,
    toggleAppDrawer,
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
      <BackgroundImage opacity={messages.length === 0 && !showArtifactsDrawer ? 80 : 0} />

      <div
        className={`flex-1 flex flex-col overflow-hidden relative ${isArtifactsResizing || isAppResizing || isAgentResizing ? "" : "transition-all duration-500 ease-in-out"}`}
        style={
          !isMobile && showAppDrawer
            ? { marginRight: `calc(${appWidthVw}vw + ${showAgentDrawer ? `${agentWidthVw}vw + 1.5rem` : "0.75rem"})` }
            : !isMobile && !showAppDrawer && showArtifactsDrawer
              ? {
                  marginRight: `calc(${artifactsWidthVw}vw + ${showAgentDrawer ? `${agentWidthVw}vw + 1.5rem` : "0.75rem"})`,
                }
              : !isMobile && showAgentDrawer && !showAppDrawer && !showArtifactsDrawer
                ? { marginRight: `calc(${agentWidthVw}vw + 0.75rem)` }
                : undefined
        }
      >
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center pt-16 relative">
              <div className="flex flex-col items-center text-center relative z-10 w-full max-w-4xl px-4 mb-16 md:mb-32">
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
              onTouchStart={() => {
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }
              }}
            >
              <div
                className={cn(
                  "px-3 pt-18 transition-[max-width] duration-150 ease-out",
                  layoutMode === "wide" ? "max-w-full md:max-w-[80vw] mx-auto" : "max-content-width",
                )}
                style={{ paddingBottom: chatInputHeight }}
              >
                <Disclaimer />

                <div>
                  {renderUnits.map((unit) => {
                    if (unit.kind === "toolGroup") {
                      // Stable key off the first member — count grows while streaming,
                      // so keying on it would needlessly remount the group.
                      return (
                        <div
                          key={`group:${messageRenderKeys[unit.indices[0]]}`}
                          className="flow-root"
                          data-role="tool-group"
                        >
                          <ChatToolGroup messages={messages} indices={unit.indices} />
                        </div>
                      );
                    }
                    const index = unit.index;
                    return (
                      <div key={messageRenderKeys[index]} className="flow-root" data-role={messages[index].role}>
                        <ChatMessage
                          index={index}
                          message={messages[index]}
                          isLast={index === messages.length - 1}
                          isResponding={isResponding}
                          onGoToLatest={goToLatest}
                        />
                      </div>
                    );
                  })}
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
        <ChatConsentBackdrop />
      </div>

      <footer
        className={cn(
          "fixed bottom-0 left-0 px-2 md:px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:pb-4 pointer-events-none z-20 transition-[left,right] duration-500 ease-in-out",
          showSidebar && chats.length > 0 && !showAgentDrawer && !showAppDrawer && !showArtifactsDrawer && "md:left-59",
          "right-0",
        )}
        style={
          !isMobile && showAppDrawer
            ? {
                right: `calc(${appWidthVw}vw + ${showAgentDrawer ? `${agentWidthVw}vw + 1.5rem` : "0.75rem"})`,
                ...(isAppResizing || isAgentResizing ? { transition: "right 50ms ease-out" } : {}),
              }
            : !isMobile && !showAppDrawer && showArtifactsDrawer
              ? {
                  right: `calc(${artifactsWidthVw}vw + ${showAgentDrawer ? `${agentWidthVw}vw + 1.5rem` : "0.75rem"})`,
                  ...(isArtifactsResizing || isAgentResizing ? { transition: "right 50ms ease-out" } : {}),
                }
              : !isMobile && showAgentDrawer && !showAppDrawer && !showArtifactsDrawer
                ? {
                    right: `calc(${agentWidthVw}vw + 0.75rem)`,
                    ...(isAgentResizing ? { transition: "right 50ms ease-out" } : {}),
                  }
                : undefined
        }
      >
        <div
          className={cn(
            "relative md:max-w-4xl mx-auto transition-transform duration-500 ease-in-out",
            messages.length === 0 &&
              !showAppDrawer &&
              !showAgentDrawer &&
              !showArtifactsDrawer &&
              "md:translate-y-[calc(50%-33.333vh)]",
          )}
        >
          <div className="pointer-events-auto">
            <ChatInput />
          </div>
        </div>
      </footer>

      <ChatConsentBanner />

      {/* Artifacts drawer - right side */}
      {shouldRenderArtifactsDrawer && (
        <div
          className={cn(
            "transform fixed right-0 md:top-14 md:bottom-0 max-w-none z-20",
            !isArtifactsResizing && "transition-all duration-300 ease-out",
            isMobile ? "w-full" : "",
            isArtifactsDrawerAnimating ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
          )}
          style={{
            width: isMobile ? undefined : `${artifactsWidthVw}vw`,
            right: !isMobile && showAgentDrawer ? `calc(${agentWidthVw}vw + 0.5rem)` : undefined,
            top: isMobile ? "48px" : undefined,
            bottom: isMobile ? 0 : undefined,
          }}
        >
          {/* Resize handle on the left edge */}
          {!isMobile && (
            <button
              type="button"
              aria-label="Resize artifacts panel"
              className="absolute -left-2 top-0 bottom-0 w-4 z-10 group flex items-center justify-center"
              style={{ cursor: "ew-resize" }}
              onMouseDown={handleArtifactsResizeMouseDown}
            >
              <div className="z-10 bg-neutral-300 rounded-sm dark:bg-neutral-700 shadow-sm opacity-60">
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
          )}
          <div className="h-full border-l border-black/10 dark:border-white/10 overflow-hidden">
            <ArtifactsDrawer />
          </div>
        </div>
      )}

      {/* Agent drawer - right side - renders over artifacts when both are visible */}
      {shouldRenderAgentDrawer && (
        <div
          className={cn(
            "w-full transform fixed right-0 md:top-14 md:bottom-0 max-w-none z-25",
            !isAgentResizing && "transition-all duration-300 ease-out",
            isMobile ? "w-full" : "",
            isAgentDrawerAnimating ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
          )}
          style={{
            width: isMobile ? undefined : `${agentWidthVw}vw`,
            maxWidth: isMobile ? undefined : "500px",
            top: isMobile ? "48px" : undefined,
            bottom: isMobile ? 0 : undefined,
          }}
        >
          {/* Resize handle on the left edge */}
          {!isMobile && (
            <button
              type="button"
              aria-label="Resize agent panel"
              className="absolute -left-2 top-0 bottom-0 w-4 z-10 group flex items-center justify-center"
              style={{ cursor: "ew-resize" }}
              onMouseDown={handleAgentResizeMouseDown}
            >
              <div className="z-10 bg-neutral-300 rounded-sm dark:bg-neutral-700 shadow-sm opacity-60">
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
          )}
          <div className="h-full border-l border-black/10 dark:border-white/10 overflow-hidden">
            <AgentDrawer />
          </div>
        </div>
      )}

      {/* App drawer - right side - for MCP tool UIs */}
      {/* Always render so iframe is available, but hide when not active */}
      <div
        className={cn(
          "w-full transform fixed right-0 md:top-14 md:bottom-0 max-w-none z-20",
          !isAppResizing && "transition-all duration-300 ease-out",
          shouldRenderAppDrawer && isAppDrawerAnimating
            ? "translate-x-0 opacity-100"
            : "translate-x-full opacity-0 pointer-events-none",
        )}
        style={{
          width: isMobile ? undefined : `${appWidthVw}vw`,
          right: !isMobile && showAgentDrawer ? `calc(${agentWidthVw}vw + 1.5rem)` : undefined,
          top: isMobile ? "48px" : undefined,
          bottom: isMobile ? 0 : undefined,
        }}
      >
        {/* Resize handle on the left edge */}
        {!isMobile && (
          <button
            type="button"
            aria-label="Resize app panel"
            className="absolute -left-2 top-0 bottom-0 w-4 z-10 group flex items-center justify-center"
            style={{ cursor: "ew-resize" }}
            onMouseDown={handleAppResizeMouseDown}
          >
            <div className="z-10 bg-neutral-300 rounded-sm dark:bg-neutral-700 shadow-sm opacity-60">
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
        )}
        <div className="h-full border-l border-black/10 dark:border-white/10 overflow-hidden flex flex-col">
          {/* Mobile close bar */}
          <div className="flex md:hidden items-center h-10 px-2 mt-4 border-b border-neutral-200/60 dark:border-neutral-700/60 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm">
            <button
              type="button"
              onClick={toggleAppDrawer}
              className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors p-1.5 rounded"
            >
              <ChevronLeft size={16} />
              <span>Back</span>
            </button>
          </div>
          <div className={cn("flex-1 overflow-hidden", isAppResizing && "pointer-events-none")}>
            <AppDrawer />
          </div>
        </div>
      </div>
      <SkillCatalog
        isOpen={showSkillCatalog}
        onClose={closeSkillCatalog}
        enabledSkillNames={agentSkillIds}
        onToggle={currentAgent && !skillCatalogReadOnly ? handleSkillToggle : undefined}
        onSkillSaved={handleSkillSaved}
        onImported={handleSkillImported}
        initialSkillName={skillCatalogTarget ?? undefined}
      />
    </div>
  );
}

export default ChatPage;
