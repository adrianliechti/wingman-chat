import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';

import { Send, Paperclip, ScreenShare, Image, X, Sparkles, Loader2, Lightbulb, Mic, Square, Package, Check, Globe, LoaderCircle, Rocket } from "lucide-react";

import { ChatInputAttachments } from "./ChatInputAttachments";
import { ChatInputSuggestions } from "./ChatInputSuggestions";

import { AttachmentType, Role } from "../types/chat";
import type { Attachment, Message } from "../types/chat";
import {
  getFileExt,
  readAsDataURL,
  readAsText,
  resizeImageBlob,
  supportedTypes,
  textTypes,
  imageTypes,
  documentTypes,
} from "../lib/utils";
import { getConfig } from "../config";
import { useChat } from "../hooks/useChat";
import { useRepositories } from "../hooks/useRepositories";
import { useTranscription } from "../hooks/useTranscription";
import { useDropZone } from "../hooks/useDropZone";
import { useSettings } from "../hooks/useSettings";
import { useScreenCapture } from "../hooks/useScreenCapture";
import { useSearch } from "../hooks/useSearch";
import { useImageGeneration } from "../hooks/useImageGeneration";

export function ChatInput() {
  const config = getConfig();
  const client = config.client;

  const { sendMessage, models, model, setModel: onModelChange, messages, isResponding, mcpConnected } = useChat();
  const { currentRepository, setCurrentRepository } = useRepositories();
  const { profile } = useSettings();
  const { isAvailable: isScreenCaptureAvailable, isActive: isContinuousCaptureActive, startCapture, stopCapture, captureFrame } = useScreenCapture();
  const { isAvailable: isSearchAvailable, isEnabled: isSearchEnabled, setEnabled: setSearchEnabled } = useSearch();
  const { isAvailable: isImageGenerationAvailable, isEnabled: isImageGenerationEnabled, setEnabled: setImageGenerationEnabled } = useImageGeneration();
  
  const [content, setContent] = useState("");
  const [transcribingContent, setTranscribingContent] = useState(false);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState<Set<string>>(new Set());

  // Prompt suggestions state
  const [showPromptSuggestions, setShowPromptSuggestions] = useState(false);
  const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate static random placeholder text for new chats only
  // Only recalculate when starting a new chat, not on every profile change
  const isNewChat = messages.length === 0;
  const randomPlaceholder = useMemo(() => {
    const personalizedVariations = [
      "Hi [Name], ready to get started?",
      "Hello [Name], what's on your mind?",
      "Welcome, [Name]! How can I help?",
      "Hi [Name], what can I do for you?",
      "[Name], how can I support you?"
    ];

    const genericVariations = [
      "Ready to get started?",
      "What's on your mind?",
      "How can I help you today?",
      "What can I do for you?",
      "How can I support you?"
    ];

    const variations = profile?.name ? personalizedVariations : genericVariations;
    const randomIndex = Math.floor(Math.random() * variations.length);
    
    return profile?.name 
      ? variations[randomIndex].replace('[Name]', profile.name)
      : variations[randomIndex];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewChat ? profile?.name : null]);

  const placeholderText = messages.length === 0 ? randomPlaceholder : "Ask anything";

  // Show placeholder when input is empty (regardless of focus state)
  const shouldShowPlaceholder = !content.trim();

  // Transcription hook
  const { canTranscribe, isTranscribing, startTranscription, stopTranscription } = useTranscription();

  // MCP indicator logic
  const mcpIndicator = useMemo(() => {
    // null = no MCP server, false = connecting, true = connected
    if (mcpConnected === null) {
      // No MCP server configured - show brain
      return <Sparkles size={14} />;
    } else if (mcpConnected === true) {
      // Connected - show rocket
      return <Rocket size={14} />;
    } else {
      // Connecting or error - show loading spinner
      return <LoaderCircle size={14} className="animate-spin" />;
    }
  }, [mcpConnected]);



  const handleFiles = useCallback(async (files: File[]) => {
    const fileIds = files.map((file, index) => `${file.name}-${index}`);
    
    // Set all extracting states at once
    setExtractingAttachments(prev => new Set([...prev, ...fileIds]));

    const processedAttachments = await Promise.allSettled(
      files.map(async (file, index) => {
        const fileId = fileIds[index];
        try {
          let attachment: Attachment | null = null;
          const fileType = file.type || getFileExt(file.name);

          if (textTypes.includes(fileType)) {
            const text = await readAsText(file);
            attachment = { type: AttachmentType.Text, name: file.name, data: text };
          } else if (imageTypes.includes(fileType)) {
            const blob = await resizeImageBlob(file, 1920, 1920);
            const url = await readAsDataURL(blob);
            attachment = { type: AttachmentType.Image, name: file.name, data: url };
          } else if (documentTypes.includes(fileType)) {
            const text = await client.extractText(file);
            attachment = { type: AttachmentType.Text, name: file.name, data: text };
          }
          
          return { fileId, attachment };
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
          return { fileId, attachment: null };
        }
      })
    );

    // Batch state updates
    const validAttachments = processedAttachments
      .filter((result): result is PromiseFulfilledResult<{ fileId: string; attachment: Attachment }> => 
        result.status === 'fulfilled' && result.value.attachment !== null
      )
      .map(result => result.value.attachment);

    setAttachments(prev => [...prev, ...validAttachments]);
    setExtractingAttachments(new Set()); // Clear all at once
  }, [client]);

  const isDragging = useDropZone(containerRef, handleFiles);

  // Handle prompt suggestions click
  const handlePromptSuggestionsClick = async () => {
    if (!model) return;

    if (showPromptSuggestions) {
      setShowPromptSuggestions(false);
      return;
    }

    setLoadingPrompts(true);
    setShowPromptSuggestions(true);

    try {
      let suggestions: string[];

      if (messages.length === 0) {
        // For new chats, use model prompts if available, otherwise get related prompts
        if (model.prompts && model.prompts.length > 0) {
          suggestions = model.prompts;
        } else {
          suggestions = await client.relatedPrompts(model.id, "");
        }
      } else {
        // Get the last few messages for context
        const contextMessages = messages.slice(-6);
        const contextText = contextMessages
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');

        suggestions = await client.relatedPrompts(model.id, contextText);
      }

      setPromptSuggestions(suggestions);
    } catch (error) {
      console.error("Error fetching prompt suggestions:", error);
      setPromptSuggestions([]);
    } finally {
      setLoadingPrompts(false);
    }
  };

  // Handle selecting a prompt suggestion
  const handlePromptSelect = (suggestion: string) => {
    // Create and send message immediately
    const message: Message = {
      role: Role.User,
      content: suggestion,
      attachments: attachments,
    };

    sendMessage(message);

    // Clear attachments after sending
    setAttachments([]);

    // Hide prompt suggestions
    setShowPromptSuggestions(false);
  };

  // Force layout recalculation on mount to fix initial sizing issues
  useEffect(() => {
    if (containerRef.current) {
      // Force a repaint by reading offsetHeight
      void containerRef.current.offsetHeight;
    }
    if (contentEditableRef.current) {
      // Force a repaint for the content editable area
      void contentEditableRef.current.offsetHeight;
    }
  }, []);

  // Auto-focus on desktop devices only (not on touch devices like iPad)
  useEffect(() => {
    if (messages.length === 0) {
      // Check if this is a touch device
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

      if (!isTouchDevice && contentEditableRef.current) {
        // Small delay to ensure DOM is ready
        const timer = setTimeout(() => {
          contentEditableRef.current?.focus();
        }, 100);

        return () => clearTimeout(timer);
      }
    }
  }, [messages.length]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();

    // Prevent submission while responding
    if (isResponding) {
      return;
    }

    if (content.trim()) {
      let finalAttachments = [...attachments];

      // If continuous capture is active, automatically capture current screen
      if (isContinuousCaptureActive) {
        try {
          const blob = await captureFrame();
          if (blob) {
            const data = await readAsDataURL(blob);
            const screenAttachment = {
              type: AttachmentType.Image,
              name: `screen-capture-${Date.now()}.png`,
              data: data,
            };
            // Add screen capture as the first attachment
            finalAttachments = [screenAttachment, ...finalAttachments];
          }
        } catch (error) {
          console.error("Error capturing screen during message send:", error);
        }
      }

      const message: Message = {
        role: Role.User,
        content: content,
        attachments: finalAttachments,
      };

      sendMessage(message);
      setContent("");
      setAttachments([]);

      if (contentEditableRef.current) {
        contentEditableRef.current.innerHTML = "";
      }
    }
  }, [isResponding, content, attachments, isContinuousCaptureActive, captureFrame, sendMessage]);

  const handleAttachmentClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleContinuousCaptureToggle = useCallback(async () => {
    try {
      if (isContinuousCaptureActive) {
        stopCapture();
      } else {
        await startCapture();
      }
    } catch (error) {
      console.error("Error toggling continuous capture:", error);
    }
  }, [isContinuousCaptureActive, stopCapture, startCapture]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      handleFiles(Array.from(files));
      e.target.value = "";
    }
  }, [handleFiles]);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleContentChange = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const input = target.innerText || target.textContent || '';
    setContent(input);

    if (input.trim() && showPromptSuggestions) {
      setShowPromptSuggestions(false);
    }
  }, [showPromptSuggestions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }, [handleSubmit]);

  // Handle transcription button click
  const handleTranscriptionClick = useCallback(async () => {
    if (isTranscribing) {
      setTranscribingContent(true);
      try {
        const text = await stopTranscription();
        if (text.trim()) {
          setContent(text);

          if (contentEditableRef.current) {
            // Convert newlines to <br> tags for proper display in contentEditable
            const htmlText = text.replace(/\n/g, '<br>');
            contentEditableRef.current.innerHTML = htmlText;
          }
        }
      } catch (error) {
        console.error('Transcription failed:', error);
      } finally {
        setTranscribingContent(false);
      }
    } else {
      try {
        await startTranscription();
      } catch (error) {
        console.error('Failed to start transcription:', error);
      }
    }
  }, [isTranscribing, stopTranscription, startTranscription]);

  return (
    <form onSubmit={handleSubmit}>
      <div
        ref={containerRef}
        className={`chat-input-container ${isDragging
          ? 'border-2 border-dashed border-slate-400 dark:border-slate-500 bg-slate-50/80 dark:bg-slate-900/40 shadow-2xl shadow-slate-500/30 dark:shadow-slate-400/20 scale-[1.02] transition-all duration-200 rounded-lg md:rounded-2xl'
          : `border-0 md:border-2 border-t-2 border-solid ${messages.length === 0
            ? 'border-neutral-200/50'
            : 'border-neutral-200'
          } dark:border-neutral-900 ${messages.length === 0
            ? 'bg-white/60 dark:bg-neutral-950/70'
            : 'bg-white/30 dark:bg-neutral-950/50'
          } rounded-t-2xl md:rounded-2xl`
          } backdrop-blur-2xl flex flex-col min-h-16 md:min-h-12 shadow-2xl shadow-black/60 dark:shadow-black/80 dark:ring-1 dark:ring-white/10 transition-all duration-200`}
      >
        <input
          type="file"
          multiple
          accept={supportedTypes.join(",")}
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Drop zone overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-linear-to-r from-slate-500/20 via-slate-600/30 to-slate-500/20 dark:from-slate-400/20 dark:via-slate-500/30 dark:to-slate-400/20 rounded-t-2xl md:rounded-2xl flex flex-col items-center justify-center pointer-events-none z-10 backdrop-blur-sm">
            <div className="text-slate-700 dark:text-slate-300 font-semibold text-lg text-center">
              Drop files here
            </div>
            <div className="text-slate-600 dark:text-slate-400 text-sm mt-1 text-center">
              Images, documents, and text files supported
            </div>
          </div>
        )}

        {/* Attachments display */}
        <ChatInputAttachments
          attachments={attachments}
          extractingAttachments={extractingAttachments}
          onRemove={handleRemoveAttachment}
        />

        {/* Prompt suggestions */}
        <ChatInputSuggestions
          show={showPromptSuggestions}
          loading={loadingPrompts}
          suggestions={promptSuggestions}
          onSelect={handlePromptSelect}
        />

        {/* Input area */}
        <div className="relative flex-1">
          <div
            ref={contentEditableRef}
            className="p-3 md:p-4 flex-1 max-h-[40vh] overflow-y-auto min-h-10 whitespace-pre-wrap wrap-break-word text-neutral-800 dark:text-neutral-200"
            style={{
              scrollbarWidth: "thin",
              minHeight: "2.5rem",
              height: "auto"
            }}
            role="textbox"
            contentEditable
            suppressContentEditableWarning={true}
            onInput={handleContentChange}
            onKeyDown={handleKeyDown}
            onPaste={async (e) => {
              e.preventDefault();

              const text = e.clipboardData.getData('text/plain');

              const imageItems = Array.from(e.clipboardData.items)
                .filter(item => item.type.startsWith('image/'))
                .map(item => item.getAsFile())
                .filter(Boolean) as File[];

              if (text.trim()) {
                document.execCommand('insertText', false, text);
              }

              if (imageItems.length > 0) {
                await handleFiles(imageItems);
              }
            }}
          />

          {/* CSS-animated placeholder */}
          {shouldShowPlaceholder && (
            <div
              className={`absolute top-3 md:top-4 left-3 md:left-4 pointer-events-none text-neutral-500 dark:text-neutral-400 transition-all duration-200 ${messages.length === 0 ? 'typewriter-text' : ''
                }`}
              style={messages.length === 0 ? {
                '--text-length': placeholderText.length,
                '--animation-duration': `${Math.max(1.5, placeholderText.length * 0.1)}s`
              } as React.CSSProperties & { '--text-length': number; '--animation-duration': string } : {}}
            >
              {placeholderText}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between p-3 pt-0 pb-8 md:pb-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              className="text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              onClick={handlePromptSuggestionsClick}
              title="Show prompt suggestions"
            >
              <Lightbulb size={16} />
            </Button>

            {models.length > 0 && (
              <Menu>
                <MenuButton className="flex items-center gap-1 pr-1.5 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm">
                  {mcpIndicator}
                  <span>
                    {model?.name ?? model?.id ?? "Select Model"}
                  </span>
                </MenuButton>
                <MenuItems
                  transition
                  anchor="bottom start"
                  className="sidebar-scroll max-h-[50vh]! mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-hidden shadow-2xl shadow-black/40 dark:shadow-black/80 z-50 min-w-52 dark:ring-1 dark:ring-white/10"
                >
                  {models.map((modelItem) => (
                    <MenuItem key={modelItem.id}>
                      <Button
                        onClick={() => onModelChange(modelItem)}
                        title={modelItem.description}
                        className="group flex w-full flex-col items-start px-3 py-2 data-focus:bg-white/30 dark:data-focus:bg-white/8 hover:bg-white/25 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-all duration-200 border-b border-white/20 dark:border-white/10 last:border-b-0"
                      >
                        <div className="flex items-center gap-2.5 w-full">
                          <div className="shrink-0 w-3.5 flex justify-center">
                            {model?.id === modelItem.id && (
                              <Check size={14} className="text-neutral-600 dark:text-neutral-400" />
                            )}
                          </div>
                          <div className="flex flex-col items-start flex-1">
                            <div className="font-semibold text-sm leading-tight">
                              {modelItem.name ?? modelItem.id}
                            </div>
                            {modelItem.description && (
                              <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 text-left leading-relaxed opacity-90">
                                {modelItem.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </Button>
                    </MenuItem>
                  ))}
                </MenuItems>
              </Menu>
            )}

            {currentRepository && (
              <div className="group flex items-center gap-1 px-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm cursor-pointer">
                <Package size={14} />
                <span className="max-w-20 truncate" title={currentRepository.name}>
                  {currentRepository.name}
                </span>
                <Button
                  onClick={() => setCurrentRepository(null)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 dark:hover:text-red-400 transition-all ml-1"
                  title="Clear repository"
                >
                  <X size={10} />
                </Button>
              </div>
            )}

          </div>

          <div className="flex items-center gap-1">
            {isSearchAvailable && (
              <Button
                type="button"
                className={`p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${isSearchEnabled
                  ? 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 bg-blue-100/80 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 rounded-lg'
                  : 'text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                onClick={() => setSearchEnabled(!isSearchEnabled)}
                title={isSearchEnabled ? 'Disable internet access' : 'Enable internet access'}
              >
                <Globe size={14} />
                {isSearchEnabled && (
                  <span className="hidden sm:inline">
                    Internet
                  </span>
                )}
              </Button>
            )}

            {isImageGenerationAvailable && (
              <Button
                type="button"
                className={`p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${isImageGenerationEnabled
                  ? 'text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200 bg-purple-100/80 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-800 rounded-lg'
                  : 'text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                onClick={() => setImageGenerationEnabled(!isImageGenerationEnabled)}
                title={isImageGenerationEnabled ? 'Disable image generation' : 'Enable image generation'}
              >
                <Image size={14} />
                {isImageGenerationEnabled && (
                  <span className="hidden sm:inline">
                    Images
                  </span>
                )}
              </Button>
            )}

            {isScreenCaptureAvailable && (
              <Button
                type="button"
                className={`p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${isContinuousCaptureActive
                  ? 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200 bg-red-100/80 dark:bg-red-900/40 border border-red-200 dark:border-red-800 rounded-lg'
                  : 'text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                onClick={handleContinuousCaptureToggle}
                title={isContinuousCaptureActive ? 'Stop continuous screen capture' : 'Start continuous screen capture'}
              >
                <ScreenShare size={14} />
                {isContinuousCaptureActive && (
                  <span className="hidden sm:inline">
                    Capturing
                  </span>
                )}
              </Button>
            )}

            <Button
              type="button"
              className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              onClick={handleAttachmentClick}
            >
              <Paperclip size={16} />
            </Button>

            {/* Dynamic Send/Mic/Loading Button */}
            {isResponding ? (
              <Button
                type="button"
                className="p-1.5 text-neutral-600 dark:text-neutral-400"
                disabled
                title="Generating response..."
              >
                <LoaderCircle size={16} className="animate-spin" />
              </Button>
            ) : content.trim() ? (
              <Button
                className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                type="submit"
              >
                <Send size={16} />
              </Button>
            ) : canTranscribe ? (
              transcribingContent ? (
                <Button
                  type="button"
                  className="p-1.5 text-neutral-600 dark:text-neutral-400"
                  disabled
                  title="Processing audio..."
                >
                  <Loader2 size={16} className="animate-spin" />
                </Button>
              ) : (
                <Button
                  type="button"
                  className={`p-1.5 transition-colors ${isTranscribing
                    ? 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200'
                    : 'text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  onClick={handleTranscriptionClick}
                  title={isTranscribing ? 'Stop recording' : 'Start recording'}
                  disabled={isResponding}
                >
                  {isTranscribing ? <Square size={16} /> : <Mic size={16} />}
                </Button>
              )
            ) : (
              <Button
                className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                type="submit"
                disabled={isResponding}
              >
                <Send size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
