import { useState, useRef, useEffect, useMemo } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';

import { Send, Paperclip, ScreenShare, Image, X, Brain, File, Loader2, FileText, Lightbulb, Mic, Square, Package, Check, Globe, LoaderCircle, Rocket, AlertTriangle } from "lucide-react";

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
import { useMCP } from "../hooks/useMCP";

export function ChatInput() {
  const config = getConfig();
  const client = config.client;

  const { sendMessage, models, model, setModel: onModelChange, messages, isResponding } = useChat();
  const { currentRepository, setCurrentRepository } = useRepositories();
  const { profile } = useSettings();
  const { isAvailable: isScreenCaptureAvailable, isActive: isContinuousCaptureActive, startCapture, stopCapture, captureFrame } = useScreenCapture();
  const { isAvailable: isSearchAvailable, isEnabled: isSearchEnabled, setEnabled: setSearchEnabled } = useSearch();
  const { isAvailable: isImageGenerationAvailable, isEnabled: isImageGenerationEnabled, setEnabled: setImageGenerationEnabled } = useImageGeneration();
  const { connectionStatus } = useMCP(model);

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

  // Generate static random placeholder text for new chats, updates when profile name changes
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
    
    if (profile?.name) {
      const randomIndex = Math.floor(Math.random() * personalizedVariations.length);
      return personalizedVariations[randomIndex].replace('[Name]', profile.name);
    } else {
      const randomIndex = Math.floor(Math.random() * genericVariations.length);
      return genericVariations[randomIndex];
    }
  }, [profile?.name]);

  const placeholderText = messages.length === 0 ? randomPlaceholder : "Ask anything";
  
  // Show placeholder when input is empty (regardless of focus state)
  const shouldShowPlaceholder = !content.trim();

  // Transcription hook
  const { canTranscribe, isTranscribing, startTranscription, stopTranscription } = useTranscription();

  // MCP indicator logic
  const getMCPIndicator = () => {
    const hasMCPTools = model?.mcpServer;
    
    if (!hasMCPTools) {
      // No MCP tools on selected model - show brain
      return <Brain size={14} />;
    }
    
    // Use the simplified connection status directly
    switch (connectionStatus) {
      case 'connected':
        return <Rocket size={14} />;
      case 'connecting':
        return <LoaderCircle size={14} className="animate-spin" />;
      case 'error':
        return <AlertTriangle size={14} />;
      default:
        return <Brain size={14} />;
    }
  };



  const handleFiles = async (files: File[]) => {
    // Process all files in parallel for better performance
    const processFile = async (file: File, index: number) => {
      const fileId = `${file.name}-${index}`;

      setExtractingAttachments(prev => new Set([...prev, fileId]));
      
      try {
        let attachment: Attachment | null = null;

        if (textTypes.includes(file.type) || textTypes.includes(getFileExt(file.name))) {
          const text = await readAsText(file);
          attachment = { type: AttachmentType.Text, name: file.name, data: text };
        } else if (imageTypes.includes(file.type) || imageTypes.includes(getFileExt(file.name))) {
          const blob = await resizeImageBlob(file, 1920, 1920);
          const url = await readAsDataURL(blob);
          attachment = { type: AttachmentType.Image, name: file.name, data: url };
        } else if (documentTypes.includes(file.type) || documentTypes.includes(getFileExt(file.name))) {
          const text = await client.extractText(file);
          attachment = { type: AttachmentType.Text, name: file.name, data: text };
        }

        if (attachment) {
          setAttachments(prev => [...prev, attachment]);
        }
        
        return attachment;
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        return null;
      } finally {
        setExtractingAttachments(prev => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
      }
    };

    // Process all files in parallel using Promise.allSettled to handle individual failures gracefully
    await Promise.allSettled(
      files.map((file, index) => processFile(file, index))
    );
  };

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

  // Helper function to get the appropriate icon for each attachment type
  const getAttachmentIcon = (attachment: Attachment) => {
    switch (attachment.type) {
      case AttachmentType.Image:
        return <Image size={24} />;
      case AttachmentType.Text:
        return <FileText size={24} />;
      case AttachmentType.File:
        return <File size={24} />;
      default:
        return <File size={24} />;
    }
  };

  // Force layout recalculation on mount to fix initial sizing issues
  useEffect(() => {
    const forceLayout = () => {
      if (containerRef.current) {
        // Force a repaint by reading offsetHeight
        void containerRef.current.offsetHeight;
      }
      if (contentEditableRef.current) {
        // Force a repaint for the content editable area
        void contentEditableRef.current.offsetHeight;
      }
    };

    // Run immediately and on next tick to ensure DOM is ready
    forceLayout();
    const timer = setTimeout(forceLayout, 0);
    
    // Also force layout on window load to handle CSS custom properties
    const handleLoad = () => forceLayout();
    window.addEventListener('load', handleLoad);
    
    // Handle resize events to maintain proper sizing
    const handleResize = () => {
      requestAnimationFrame(forceLayout);
    };
    window.addEventListener('resize', handleResize);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('load', handleLoad);
      window.removeEventListener('resize', handleResize);
    };
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

  const handleSubmit = async (e: FormEvent) => {
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
  };

  const handleAttachmentClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleContinuousCaptureToggle = async () => {
    try {
      if (isContinuousCaptureActive) {
        stopCapture();
      } else {
        await startCapture();
      }
    } catch (error) {
      console.error("Error toggling continuous capture:", error);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      handleFiles(Array.from(files));
      e.target.value = "";
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  // Handle transcription button click
  const handleTranscriptionClick = async () => {
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
  };

  return (
    <form onSubmit={handleSubmit}>
      <div 
        ref={containerRef}
        className={`chat-input-container ${
          isDragging 
            ? 'border-2 border-dashed border-slate-400 dark:border-slate-500 bg-slate-50/80 dark:bg-slate-900/40 shadow-2xl shadow-slate-500/30 dark:shadow-slate-400/20 scale-[1.02] transition-all duration-200 rounded-lg md:rounded-2xl' 
            : `border-0 md:border-2 border-t-2 border-solid ${
                messages.length === 0 
                  ? 'border-neutral-200/50' 
                  : 'border-neutral-200'
              } dark:border-neutral-900 ${
                messages.length === 0 
                  ? 'bg-white/60 dark:bg-neutral-950/70' 
                  : 'bg-white/30 dark:bg-neutral-950/50'
              } rounded-t-2xl md:rounded-2xl`
        } backdrop-blur-2xl flex flex-col min-h-[4rem] md:min-h-[3rem] shadow-2xl shadow-black/60 dark:shadow-black/80 dark:ring-1 dark:ring-white/10 transition-all duration-200`}
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
          <div className="absolute inset-0 bg-gradient-to-r from-slate-500/20 via-slate-600/30 to-slate-500/20 dark:from-slate-400/20 dark:via-slate-500/30 dark:to-slate-400/20 rounded-t-2xl md:rounded-2xl flex flex-col items-center justify-center pointer-events-none z-10 backdrop-blur-sm">
            <div className="text-slate-700 dark:text-slate-300 font-semibold text-lg text-center">
              Drop files here
            </div>
            <div className="text-slate-600 dark:text-slate-400 text-sm mt-1 text-center">
              Images, documents, and text files supported
            </div>
          </div>
        )}

        {/* Attachments display */}
        {(attachments.length > 0 || extractingAttachments.size > 0) && (
          <div className="flex flex-wrap gap-3 p-3">
            {/* Loading attachments */}
            {Array.from(extractingAttachments).map((fileId) => (
              <div
                key={fileId}
                className="relative size-14 bg-white/30 dark:bg-neutral-800/60 backdrop-blur-lg rounded-xl border-2 border-dashed border-white/50 dark:border-white/30 flex items-center justify-center shadow-sm"
                title="Processing file..."
              >
                <Loader2 size={18} className="animate-spin text-neutral-500 dark:text-neutral-400" />
              </div>
            ))}
            
            {/* Processed attachments */}
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className="relative size-14 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-sm flex items-center justify-center group hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all"
                title={attachment.name}
              >
                {attachment.type === AttachmentType.Image ? (
                  <img 
                    src={attachment.data} 
                    alt={attachment.name}
                    className="size-full object-cover rounded-xl"
                  />
                ) : (
                  <div className="text-neutral-600 dark:text-neutral-300">
                    {getAttachmentIcon(attachment)}
                  </div>
                )}
                <Button
                  type="button"
                  className="absolute top-0.5 right-0.5 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
                  onClick={() => handleRemoveAttachment(index)}
                >
                  <X size={10} />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Prompt suggestions */}
        {showPromptSuggestions && (
          <div className="p-3">
            {loadingPrompts ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-neutral-500 dark:text-neutral-400" />
                <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">
                  Generating suggestions...
                </span>
              </div>
            ) : promptSuggestions.length > 0 ? (
              <div className="space-y-2">
                {promptSuggestions.map((suggestion, index) => (
                  <Button
                    key={index}
                    type="button"
                    onClick={() => handlePromptSelect(suggestion)}
                    className="w-full text-left p-3 text-sm bg-white/25 dark:bg-black/15 backdrop-blur-lg hover:bg-white/40 dark:hover:bg-black/25 rounded-lg border border-white/30 dark:border-white/20 transition-colors focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-neutral-500 dark:text-neutral-400">
                No suggestions available
              </div>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="relative flex-1">
          <div
            ref={contentEditableRef}
            className="p-3 md:p-4 flex-1 max-h-[40vh] overflow-y-auto min-h-[2.5rem] whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-200"
            style={{ 
              scrollbarWidth: "thin",
              minHeight: "2.5rem",
              height: "auto"
            }}
            role="textbox"
            contentEditable
            suppressContentEditableWarning={true}
            onInput={(e) => {
              const target = e.target as HTMLDivElement;

              const input = target.innerText || target.textContent || '';
              setContent(input);
              
              if (input.trim() && showPromptSuggestions) {
                setShowPromptSuggestions(false);
              }
            }}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData('text/plain');
              document.execCommand('insertText', false, text);
            }}
          />
          
          {/* CSS-animated placeholder */}
          {shouldShowPlaceholder && (
            <div 
              className={`absolute top-3 md:top-4 left-3 md:left-4 pointer-events-none text-neutral-500 dark:text-neutral-400 transition-all duration-200 ${
                messages.length === 0 ? 'typewriter-text' : ''
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
                  {getMCPIndicator()}
                  <span>
                    {model?.name ?? model?.id ?? "Select Model"}
                  </span>
                </MenuButton>
                <MenuItems
                  transition
                  anchor="bottom start"
                  className="sidebar-scroll !max-h-[50vh] mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-hidden shadow-2xl shadow-black/40 dark:shadow-black/80 z-50 min-w-52 dark:ring-1 dark:ring-white/10"
                >
                  {models.map((modelItem) => (
                    <MenuItem key={modelItem.id}>
                      <Button
                        onClick={() => onModelChange(modelItem)}
                        title={modelItem.description}
                        className="group flex w-full flex-col items-start px-3 py-2 data-[focus]:bg-white/30 dark:data-[focus]:bg-white/8 hover:bg-white/25 dark:hover:bg-white/5 text-neutral-800 dark:text-neutral-200 transition-all duration-200 border-b border-white/20 dark:border-white/10 last:border-b-0"
                      >
                        <div className="flex items-center gap-2.5 w-full">
                          <div className="flex-shrink-0 w-3.5 flex justify-center">
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
                className={`p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${
                  isSearchEnabled 
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
                className={`p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${
                  isImageGenerationEnabled 
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
                className={`p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${
                  isContinuousCaptureActive 
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
                  className={`p-1.5 transition-colors ${
                    isTranscribing 
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
