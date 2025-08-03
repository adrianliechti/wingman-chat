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
import { FileSystem } from "../types/file";
import { Chat } from "../types/chat";

export function ChatPage() {
  const {
    chat,
    messages,
    createChat,
    chats,
    updateChat
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

  // Set up artifacts filesystem integration with chat.files
  useEffect(() => {
    if (!chat || !artifactsAvailable) {
      setFileSystemManager(null);
      return;
    }

    // Create FileSystemManager that uses chat.files as persistence
    const manager = new FileSystemManager(
      // getFilesystem: returns current filesystem state from chat.files
      () => {
        const currentChat = chats.find(c => c.id === chat.id);
        return currentChat?.files || {};
      },
      
      // setFilesystem: updates chat.files through functional updateChat
      (updater: (current: FileSystem) => FileSystem) => {
        updateChat(chat.id, (currentChat: Chat) => ({
          files: updater(currentChat.files || {})
        }));
      },
      
      // onFileCreated callback
      (path: string) => {
        console.log(`📄 Artifacts: File created: ${path}`);
      },
      
      // onFileDeleted callback
      (path: string) => {
        console.log(`🗑️ Artifacts: File deleted: ${path}`);
      },
      
      // onFileRenamed callback
      (oldPath: string, newPath: string) => {
        console.log(`📁 Artifacts: File renamed: ${oldPath} → ${newPath}`);
      }
    );

    setFileSystemManager(manager);
  }, [chat, chats, artifactsAvailable, setFileSystemManager, updateChat]);

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
                      src="/logo.svg" 
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
              <div className={`px-3 pt-18 pb-28 ${
                layoutMode === 'wide'
                  ? 'max-w-full md:max-w-[80vw] mx-auto' 
                  : 'max-content-width'
              }`}>
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
                  <ChatMessage key={idx} message={message} isLast={idx === messages.length - 1} />
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
          <div className={`fixed bottom-0 left-0 h-32 z-20 pointer-events-none bg-gradient-to-t from-white via-white/80 to-transparent dark:from-neutral-900 dark:via-neutral-900/80 dark:to-transparent transition-all duration-300 ease-out ${
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
                  <span>No custom model support</span>
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