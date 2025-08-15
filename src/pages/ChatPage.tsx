import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Plus as PlusIcon, Mic, MicOff, Package, PackageOpen, AlertTriangle, Info, BookText, BookOpenText } from "lucide-react";
import { Button, Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { getConfig } from "../config";
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
import { useArtifacts } from "../hooks/useArtifacts";
import { RepositoryDrawer } from "../components/RepositoryDrawer";
import { ArtifactsDrawer } from "../components/ArtifactsDrawer";
import { FileSystemManager } from "../lib/fs";
import type { FileSystem } from "../types/file";
import type { Chat } from "../types/chat";

export function ChatPage() {
  const {
    chat,
    messages,
    createChat,
    chats,
    updateChat,
    isResponding
  } = useChat();
  
  const { layoutMode } = useLayout();
  const { isAvailable: voiceAvailable, startVoice, stopVoice } = useVoice();
  const { isAvailable: artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer, setFileSystemManager } = useArtifacts();
  const { isAvailable: repositoryAvailable, toggleRepositoryDrawer, showRepositoryDrawer } = useRepositories();
  
  // Only need backgroundImage to check if background should be shown
  const { backgroundImage } = useBackground();
  
  // Local state for voice mode (UI state)
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  
  // Voice mode preview dialog state
  const [showVoicePreviewDialog, setShowVoicePreviewDialog] = useState(false);
  
  // Repository drawer state
  const [isRepositoryDrawerAnimating, setIsRepositoryDrawerAnimating] = useState(false);
  const [isArtifactsDrawerAnimating, setIsArtifactsDrawerAnimating] = useState(false);
  const [shouldRenderRepositoryDrawer, setShouldRenderRepositoryDrawer] = useState(false);
  const [shouldRenderArtifactsDrawer, setShouldRenderArtifactsDrawer] = useState(false);
  
  // Toggle voice mode handler
  const toggleVoiceMode = useCallback(async () => {
    if (isVoiceMode) {
      await stopVoice();
      setIsVoiceMode(false);
    } else {
      // Show preview dialog before starting voice mode
      setShowVoicePreviewDialog(true);
    }
  }, [isVoiceMode, stopVoice]);
  
  // Start voice mode after dialog confirmation
  const startVoiceMode = useCallback(async () => {
    setShowVoicePreviewDialog(false);
    
    await startVoice();
    setIsVoiceMode(true);
  }, [startVoice]);
  
  // Sidebar integration (now only controls visibility)
  const { setSidebarContent } = useSidebar();
  const { setRightActions } = useNavigation();

  const { containerRef, bottomRef, handleScroll, enableAutoScroll } = useAutoScroll({
    dependencies: [chat, messages],
  });

  // Ref to track chat input height for dynamic padding
  const [chatInputHeight, setChatInputHeight] = useState(112); // Default to pb-28 (7rem = 112px)

  // Ref to get current chat without causing effect dependencies
  const getCurrentChatRef = useRef<() => Chat | null>(() => null);
  
  // Update the ref whenever chat or chats change
  useEffect(() => {
    getCurrentChatRef.current = () => {
      if (!chat?.id) return null;
      return chats.find(c => c.id === chat.id) || null;
    };
  }, [chat?.id, chats]);

  // Set up artifacts filesystem integration with chat.files
  useEffect(() => {
    if (!chat?.id || !artifactsAvailable) {
      setFileSystemManager(null);
      return;
    }

    const chatId = chat.id;

    // Create FileSystemManager that uses chat.files as persistence
    const manager = new FileSystemManager(
      // getFilesystem: returns current filesystem state from chat.files
      () => {
        const currentChat = getCurrentChatRef.current();
        return currentChat?.artifacts || {};
      },
      
      // setFilesystem: updates chat.files through functional updateChat
      (updater: (current: FileSystem) => FileSystem) => {
        updateChat(chatId, (currentChat: Chat) => ({
          artifacts: updater(currentChat.artifacts || {})
        }));
      }
    );

    // Subscribe to file events
    const unsubscribeCreated = manager.subscribe('fileCreated', (path: string) => {
      console.log(`📄 Artifacts: File created: ${path}`);
    });

    const unsubscribeDeleted = manager.subscribe('fileDeleted', (path: string) => {
      console.log(`🗑️ Artifacts: File deleted: ${path}`);
    });

    const unsubscribeRenamed = manager.subscribe('fileRenamed', (oldPath: string, newPath: string) => {
      console.log(`📁 Artifacts: File renamed: ${oldPath} → ${newPath}`);
    });

    const unsubscribeUpdated = manager.subscribe('fileUpdated', (path: string) => {
      console.log(`✏️ Artifacts: File updated: ${path}`);
    });

    setFileSystemManager(manager);

    // Cleanup subscriptions when effect runs again or unmounts
    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [chat?.id, artifactsAvailable, updateChat, setFileSystemManager]);

  // Set up navigation actions (only once on mount)
  useEffect(() => {
    setRightActions(
      <div className="flex items-center gap-2">
        {repositoryAvailable && (
          <Button
            className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            onClick={toggleRepositoryDrawer}
            title={showRepositoryDrawer ? 'Close repositories' : 'Open repositories'}
          >
            {showRepositoryDrawer ? <PackageOpen size={20} /> : <Package size={20} />}
          </Button>
        )}
        {artifactsAvailable && (
          <Button
            className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            onClick={toggleArtifactsDrawer}
            title={showArtifactsDrawer ? 'Close artifacts' : 'Open artifacts'}
          >
            {showArtifactsDrawer ? <BookOpenText size={20} /> : <BookText size={20} />}
          </Button>
        )}
        {voiceAvailable && (
          <Button
            className={`p-2 rounded transition-all duration-150 ease-out ${
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
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
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
  }, [setRightActions, createChat, isVoiceMode, toggleVoiceMode, voiceAvailable, repositoryAvailable, showRepositoryDrawer, toggleRepositoryDrawer, artifactsAvailable, showArtifactsDrawer, toggleArtifactsDrawer]);

  // Handle repository drawer animation
  useEffect(() => {
    if (showRepositoryDrawer) {
      setShouldRenderRepositoryDrawer(true);
      // Small delay to ensure the element is in the DOM before animating
      setTimeout(() => {
        setIsRepositoryDrawerAnimating(true);
      }, 10);
    } else {
      setIsRepositoryDrawerAnimating(false);
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
      setShouldRenderArtifactsDrawer(true);
      // Small delay to ensure the element is in the DOM before animating
      setTimeout(() => {
        setIsArtifactsDrawerAnimating(true);
      }, 10);
    } else {
      setIsArtifactsDrawerAnimating(false);
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
        showArtifactsDrawer ? 'md:mr-[calc(70vw+0.75rem)]' : 
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
              className={`flex-1 overflow-auto ios-scroll sidebar-scroll transition-opacity duration-300 ${
                isVoiceMode ? 'opacity-90' : 'opacity-100'
              }`}
              ref={containerRef}
              onScroll={handleScroll}
            >
              <div className={`px-3 pt-18 transition-all duration-150 ease-out ${
                layoutMode === 'wide'
                  ? 'max-w-full md:max-w-[80vw] mx-auto' 
                  : 'max-content-width'
              }`} style={{ paddingBottom: `${chatInputHeight}px` }}>
                {(() => {
                  try {
                    const config = getConfig();
                    const disclaimer = config.disclaimer;
                    if (disclaimer && disclaimer.trim()) {
                      return (
                        <div className="mb-6 mx-auto max-w-2xl">
                          <div className="flex items-start justify-center gap-2 px-4 py-3">
                            <Info size={16} className="text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-neutral-600 dark:text-neutral-400 text-left">
                              {disclaimer}
                            </p>
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
        </main>

        {/* Chat Input - hidden during voice mode */}
        {!isVoiceMode && (
          <footer className={`fixed bottom-0 left-0 md:px-3 md:pb-4 pointer-events-none z-20 transition-all duration-300 ease-out ${
            messages.length === 0 ? 'md:bottom-1/3 md:transform md:translate-y-1/2' : ''
          } ${
            showArtifactsDrawer ? 'right-0 md:right-[calc(70vw+0.75rem)]' :
            showRepositoryDrawer ? 'right-0 md:right-[calc(20rem+0.75rem)]' : 'right-0'
          }`}>
            <div className="relative pointer-events-auto md:max-w-4xl mx-auto">
              <ChatInput />
            </div>
          </footer>
        )}

        {/* Full-width waves during voice mode */}
        {isVoiceMode && (
          <div className={`fixed bottom-0 left-0 h-32 z-20 pointer-events-none transition-all duration-300 ease-out ${
            showArtifactsDrawer ? 'right-0 md:right-[calc(70vw+0.75rem)]' :
            showRepositoryDrawer ? 'right-0 md:right-[calc(20rem+0.75rem)]' : 'right-0'
          }`}>
            <VoiceWaves />
          </div>
        )}
      </div>

      {/* Backdrop overlay for repository drawer on mobile */}
      {shouldRenderRepositoryDrawer && (
        <div
          className={`fixed inset-0 bg-black/20 z-30 transition-opacity duration-300 md:hidden ${
            isRepositoryDrawerAnimating ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => toggleRepositoryDrawer()}
        />
      )}

      {/* Backdrop overlay for artifacts drawer on mobile */}
      {artifactsAvailable && shouldRenderArtifactsDrawer && (
        <div
          className={`fixed inset-0 bg-black/20 z-30 transition-opacity duration-300 md:hidden ${
            isArtifactsDrawerAnimating ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => toggleArtifactsDrawer()}
        />
      )}

      {/* Repository drawer - right side */}
      {repositoryAvailable && shouldRenderRepositoryDrawer && !showArtifactsDrawer && (
        <div className={`w-80 bg-neutral-50/60 dark:bg-neutral-950/70 backdrop-blur-sm shadow-2xl border-l border-neutral-200 dark:border-neutral-900 top-18 bottom-4 z-40 rounded-xl transition-all duration-300 ease-out transform ${
          isRepositoryDrawerAnimating 
            ? 'translate-x-0 opacity-100 scale-100' 
            : 'translate-x-full opacity-0 scale-95'
        } ${ 
          // On mobile: full width overlay from right edge, on desktop: positioned with right-3
          'fixed right-0 md:right-3 md:w-80 w-full max-w-sm'
        }`}>
          <RepositoryDrawer />
        </div>
      )}

      {/* Artifacts drawer - right side - takes priority over repository drawer */}
      {artifactsAvailable && shouldRenderArtifactsDrawer && (
        <div className={`w-full bg-neutral-50/60 dark:bg-neutral-950/70 backdrop-blur-sm shadow-2xl border-l border-neutral-200 dark:border-neutral-900 top-18 bottom-4 z-40 rounded-xl transition-all duration-300 ease-out transform ${
          isArtifactsDrawerAnimating 
            ? 'translate-x-0 opacity-100 scale-100' 
            : 'translate-x-full opacity-0 scale-95'
        } ${ 
          // On mobile: full width overlay from right edge, on desktop: positioned with right-3 and 70% width
          'fixed right-0 md:right-3 md:w-[70vw] max-w-none'
        }`}>
          <ArtifactsDrawer />
        </div>
      )}

      {/* Voice Mode Preview Dialog */}
      <Dialog open={showVoicePreviewDialog} onClose={() => setShowVoicePreviewDialog(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-md rounded-xl bg-white dark:bg-neutral-900 p-6 shadow-2xl border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
              </div>
              <DialogTitle className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Voice Mode Early Preview
              </DialogTitle>
            </div>
            
            <div className="mb-6">
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                Current limitations:
              </p>
              <ul className="text-sm text-neutral-700 dark:text-neutral-300 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-neutral-400 dark:text-neutral-500 mt-1">•</span>
                  <span>Limited to GPT-4o (Oct 01, 2023)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-neutral-400 dark:text-neutral-500 mt-1">•</span>
                  <span>Knowledge Bases uses RAG mode only</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-neutral-400 dark:text-neutral-500 mt-1">•</span>
                  <span>Context Window limited to ~30 pages</span>
                </li>
              </ul>
            </div>
            
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => setShowVoicePreviewDialog(false)}
                className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
              >
                Cancel
              </Button>
              <Button
                onClick={startVoiceMode}
                className="px-4 py-2 text-sm font-medium bg-neutral-800 hover:bg-neutral-900 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-white rounded-lg transition-colors"
              >
                Continue
              </Button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}

export default ChatPage;