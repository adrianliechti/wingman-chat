import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Plus as PlusIcon, Mic, MicOff, Package, PackageOpen } from "lucide-react";
import { Button } from "@headlessui/react";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { useSidebar } from "../hooks/useSidebar";
import { useNavigation } from "../hooks/useNavigation";
import { useLayout } from "../hooks/useLayout";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import { useBackground } from "../hooks/useBackground";
import { ChatInput } from "../components/ChatInput";
import { ChatMessage } from "../components/ChatMessage";
import { ChatSidebar } from "../components/ChatSidebar";
import { VoiceWaves } from "../components/VoiceWaves";
import { BackgroundImage } from "../components/BackgroundImage";
import { useRepositories } from "../hooks/useRepositories";
import { RepositoryDrawer } from "../components/RepositoryDrawer";

export function ChatPage() {
  const {
    chat,
    messages,
    createChat,
    chats
  } = useChat();
  
  const { layoutMode } = useLayout();
  const { isAvailable: voiceAvailable, startVoice, stopVoice } = useVoice();
  const { isAvailable: repositoryAvailable, toggleRepositoryDrawer, showRepositoryDrawer } = useRepositories();
  
  // Only need backgroundImage to check if background should be shown
  const { backgroundImage } = useBackground();
  
  // Local state for voice mode (UI state)
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  
  // Repository drawer state
  const [isRepositoryDrawerAnimating, setIsRepositoryDrawerAnimating] = useState(false);
  const [shouldRenderDrawer, setShouldRenderDrawer] = useState(false);
  
  // Toggle voice mode handler
  const toggleVoiceMode = useCallback(async () => {
    if (isVoiceMode) {
      await stopVoice();
      setIsVoiceMode(false);
    } else {
      await startVoice();
      setIsVoiceMode(true);
    }
  }, [isVoiceMode, startVoice, stopVoice]);
  
  // Sidebar integration (now only controls visibility)
  const { setSidebarContent } = useSidebar();
  const { setRightActions } = useNavigation();

  const { containerRef, bottomRef, handleScroll, enableAutoScroll } = useAutoScroll({
    dependencies: [chat, messages],
  });

  // Animation state for chat input
  const [isAnimating, setIsAnimating] = useState(false);
  const prevMessagesCountRef = useRef(0);

  // Set up navigation actions (only once on mount)
  useEffect(() => {
    setRightActions(
      <div className="flex items-center gap-2">
        {repositoryAvailable && (
          <Button
            className="p-2 rounded transition-all duration-150 ease-out cursor-pointer text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            onClick={toggleRepositoryDrawer}
            title={showRepositoryDrawer ? 'Close repositories' : 'Open repositories'}
          >
            {showRepositoryDrawer ? <PackageOpen size={20} /> : <Package size={20} />}
          </Button>
        )}
        {voiceAvailable && (
          <Button
            className={`p-2 rounded transition-all duration-150 ease-out cursor-pointer ${
              isVoiceMode 
                ? 'text-red-600 dark:text-red-400 hover:text-neutral-800 dark:hover:text-neutral-200' 
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
            onClick={toggleVoiceMode}
            title={isVoiceMode ? 'Stop voice mode' : 'Start voice mode'}
          >
            {isVoiceMode ? <MicOff size={20} /> : <Mic size={20} />}
          </Button>
        )}
        <Button
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out cursor-pointer"
          onClick={createChat}
        >
          <PlusIcon size={20} />
        </Button>
      </div>
    );

    // Cleanup when component unmounts
    return () => {
      setRightActions(null);
    };
  }, [setRightActions, createChat, isVoiceMode, toggleVoiceMode, voiceAvailable, repositoryAvailable, showRepositoryDrawer, toggleRepositoryDrawer]);

  // Handle repository drawer animation
  useEffect(() => {
    if (showRepositoryDrawer) {
      setShouldRenderDrawer(true);
      // Small delay to ensure the element is in the DOM before animating
      setTimeout(() => {
        setIsRepositoryDrawerAnimating(true);
      }, 10);
    } else {
      setIsRepositoryDrawerAnimating(false);
      // Remove from DOM after animation completes
      const timer = setTimeout(() => {
        setShouldRenderDrawer(false);
      }, 300); // Match the transition duration
      return () => clearTimeout(timer);
    }
  }, [showRepositoryDrawer]);

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

  // Force scroll to bottom only for new user messages, not streaming updates
  const prevMessagesLengthRef = useRef(messages.length);
  useEffect(() => {
    // Only force scroll if a completely new message was added (not just updated)
    if (messages.length > prevMessagesLengthRef.current) {
      // This indicates a new message was added (user or assistant), not just streaming content
      enableAutoScroll();
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, enableAutoScroll]);

  // Handle animation when first message is added
  useEffect(() => {
    if (prevMessagesCountRef.current === 0 && messages.length > 0) {
      setIsAnimating(true);
      // Reset animation state after animation completes
      const animationTimer = setTimeout(() => {
        setIsAnimating(false);
      }, 600); // Match the CSS transition duration
      
      return () => {
        clearTimeout(animationTimer);
      };
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages.length]);

  return (
    <div className="h-full w-full flex overflow-hidden relative">
      {messages.length === 0 && <BackgroundImage />}
      
      {/* Main content area */}
      <div className={`flex-1 flex flex-col overflow-hidden relative transition-all duration-300 ${
        showRepositoryDrawer ? 'md:mr-80 md:pr-3' : ''
      }`}>
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center pt-16 relative">
              <div className="flex flex-col items-center text-center relative z-10 w-full max-w-4xl px-4 mb-32">
                {/* Logo - only show if no background image is available */}
                {!backgroundImage && (
                  <div className="mb-8">
                    <img 
                      src="/logo.svg" 
                      alt="Wingman Chat" 
                      className="h-24 w-24 opacity-80 dark:opacity-60"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className={`flex-1 overflow-auto ios-scroll sidebar-scroll transition-opacity duration-300 ${
                isVoiceMode ? 'opacity-90' : 'opacity-100'
              }`}
              ref={containerRef}
              onScroll={handleScroll}
            >
              <div className={`px-2 pt-20 pb-28 ${
                layoutMode === 'wide'
                  ? 'max-w-full md:max-w-[80vw] mx-auto' 
                  : 'max-content-width'
              }`}>
                {messages.map((message, idx) => (
                  <ChatMessage key={idx} message={message} />
                ))}
                
                {/* sentinel for scrollIntoView */}
                <div ref={bottomRef} />
              </div>
            </div>
          )}
        </main>

        {/* Chat Input - hidden during voice mode */}
        {!isVoiceMode && (
          <footer className={`absolute left-0 right-0 bg-transparent md:pb-4 pb-safe-bottom px-3 pl-safe-left pr-safe-right pointer-events-none transition-all duration-600 ease-out z-20 ${
            messages.length === 0 ? 'bottom-1/3 transform translate-y-1/2' : 'bottom-0'
          } ${isAnimating ? 'transition-all duration-600 ease-out' : ''}`}>
            <div className={`relative pointer-events-auto ${
              layoutMode === 'wide' ? 'max-w-full md:max-w-[80vw] mx-auto' : 'max-content-width'
            } ${messages.length === 0 ? 'max-w-4xl' : ''} ${
              showRepositoryDrawer ? 'md:mr-80 md:pr-4' : ''
            }`}>
              <ChatInput />
            </div>
          </footer>
        )}

        {/* Full-width waves during voice mode */}
        {isVoiceMode && (
          <div className="fixed bottom-0 left-0 right-0 h-32 z-20 pointer-events-none bg-gradient-to-t from-white via-white/80 to-transparent dark:from-neutral-900 dark:via-neutral-900/80 dark:to-transparent">
            <VoiceWaves />
          </div>
        )}
      </div>

      {/* Backdrop overlay for repository drawer on mobile */}
      {shouldRenderDrawer && (
        <div
          className={`fixed inset-0 bg-black/20 z-30 transition-opacity duration-300 md:hidden ${
            isRepositoryDrawerAnimating ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => toggleRepositoryDrawer()}
        />
      )}

      {/* Repository drawer - right side */}
      {shouldRenderDrawer && (
        <div className={`w-80 bg-neutral-50/60 dark:bg-neutral-950/70 backdrop-blur-sm shadow-2xl border-l border-neutral-200 dark:border-neutral-900 fixed top-16 bottom-4 z-40 rounded-xl transition-all duration-300 ease-out transform ${
          isRepositoryDrawerAnimating 
            ? 'translate-x-0 opacity-100 scale-100' 
            : 'translate-x-full opacity-0 scale-95'
        } ${ 
          // On mobile: full width overlay from right edge, on desktop: positioned with right-3
          'right-0 md:right-3 md:w-80 w-full max-w-sm'
        }`}>
          <RepositoryDrawer />
        </div>
      )}
    </div>
  );
}

export default ChatPage;