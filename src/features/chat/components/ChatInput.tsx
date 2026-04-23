import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  AudioLines,
  Bot,
  Check,
  HardDrive,
  Loader2,
  LoaderCircle,
  MessageSquare,
  Mic,
  Paperclip,
  Rocket,
  ScreenShare,
  Send,
  Sliders,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useChat } from "@/features/chat/hooks/useChat";
import { useScreenCapture } from "@/features/chat/hooks/useScreenCapture";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { useTranscription } from "@/features/voice/hooks/useTranscription";
import { useVoice } from "@/features/voice/hooks/useVoice";
import { getConfig } from "@/shared/config";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { acceptTypes, canConvert, convertFileToText } from "@/shared/lib/convert";
import { getDriveContentUrl } from "@/shared/lib/drives";
import { readAsDataURL, resizeImageBlob } from "@/shared/lib/utils";
import type { Content, ImageContent, Message, TextContent, ToolProvider } from "@/shared/types/chat";
import { ProviderState, Role } from "@/shared/types/chat";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { ChatInputAttachments } from "./ChatInputAttachments";

export function ChatInput() {
  const config = getConfig();

  const { sendMessage, models, model, setModel: onModelChange, messages, isResponding, stopStreaming } = useChat();
  const { currentAgent, setCurrentAgent } = useAgents();
  const { profile } = useSettings();
  const {
    isAvailable: isScreenCaptureAvailable,
    isActive: isContinuousCaptureActive,
    startCapture,
    stopCapture,
    captureFrame,
  } = useScreenCapture();
  const { providers, getProviderState, setProviderEnabled, setModelOverrides } = useToolsContext();
  const { isAvailable: voiceAvailable, isListening, audioLevel, startVoice, stopVoice, sendText: sendVoiceText } = useVoice();

  // Track if realtime mode model is selected (either via model picker or agent's model)
  const isRealtimeSelected = model?.id === "realtime" || currentAgent?.model === "realtime";

  // Stop voice when realtime is deselected
  useEffect(() => {
    if (!isRealtimeSelected && isListening) {
      stopVoice();
    }
  }, [isRealtimeSelected, isListening, stopVoice]);

  const [content, setContent] = useState("");
  const [transcribingContent, setTranscribingContent] = useState(false);
  const [voiceTextInput, setVoiceTextInput] = useState("");

  const [attachments, setAttachments] = useState<Content[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState<Set<string>>(new Set());

  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentInputRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const modeSliderRef = useRef<HTMLDivElement>(null);
  const [modeSliderStyle, setModeSliderStyle] = useState({ left: 0, width: 0 });
  const profileName = profile?.name;

  useEffect(() => {
    const container = modeSliderRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(`[data-mode="${isRealtimeSelected ? 'voice' : 'chat'}"]`);
    if (!active) return;
    const cr = container.getBoundingClientRect();
    const br = active.getBoundingClientRect();
    setModeSliderStyle({ left: br.left - cr.left, width: br.width });
  }, [isRealtimeSelected]);

  // Generate static random placeholder text for new chats only
  const randomPlaceholder = useMemo(() => {
    const personalizedVariations = [
      "Hi [Name], ready to get started?",
      "Hello [Name], what's on your mind?",
      "Welcome, [Name]! How can I help?",
      "Hi [Name], what can I do for you?",
      "[Name], how can I support you?",
    ];

    const genericVariations = [
      "Ready to get started?",
      "What's on your mind?",
      "How can I help you today?",
      "What can I do for you?",
      "How can I support you?",
    ];

    const variations = profileName ? personalizedVariations : genericVariations;
    const randomIndex = Math.floor(Math.random() * variations.length);

    return profileName ? variations[randomIndex].replace("[Name]", profileName) : variations[randomIndex];
  }, [profileName]);

  const placeholderText = messages.length === 0 ? randomPlaceholder : "Ask anything";

  // Show placeholder when input is empty (regardless of focus state)
  const shouldShowPlaceholder = !content.trim();

  // Transcription hook
  const { canTranscribe, isTranscribing, startTranscription, stopTranscription } = useTranscription();

  const modelTools = useMemo(() => {
    const ids = new Set<string>();
    (model?.tools?.enabled || []).forEach((id) => {
      ids.add(id);
    });
    (model?.tools?.disabled || []).forEach((id) => {
      ids.add(id);
    });
    return ids;
  }, [model?.tools]);

  // Providers visible in the UI: exclude model-configured and artifacts; hidden entirely when agent active
  const visibleProviders = useMemo(
    () => (currentAgent ? [] : providers.filter((p: ToolProvider) => p.id !== "artifacts" && !modelTools.has(p.id))),
    [currentAgent, providers, modelTools],
  );

  // Tool providers indicator logic
  const toolIndicator = useMemo(() => {
    // Check if any providers are connected
    const hasConnectedProviders = visibleProviders.some(
      (provider: ToolProvider) => getProviderState(provider.id) === ProviderState.Connected,
    );

    // Check if any providers are initializing
    const hasInitializingProviders = visibleProviders.some(
      (provider: ToolProvider) => getProviderState(provider.id) === ProviderState.Initializing,
    );

    if (hasInitializingProviders) {
      // At least one provider initializing - show loading spinner
      return <LoaderCircle size={14} className="animate-spin" />;
    } else if (hasConnectedProviders) {
      // At least one provider connected - show rocket
      return <Rocket size={14} />;
    } else {
      // No providers connected - show sparkles
      return <Sparkles size={14} />;
    }
  }, [visibleProviders, getProviderState]);

  // Apply model-level forced tool overrides (delta over user + agent tools)
  useEffect(() => {
    setModelOverrides(model?.tools?.enabled || [], model?.tools?.disabled || []);
  }, [model?.tools?.enabled, model?.tools?.disabled, setModelOverrides]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const fileIds = files.map((file, index) => `${file.name}-${index}`);

      // Set all extracting states at once
      setExtractingAttachments((prev) => new Set([...prev, ...fileIds]));

      const visionFiles = config.vision?.files ?? [];

      const processedContents = await Promise.allSettled(
        files.map(async (file, index) => {
          const fileId = fileIds[index];
          try {
            let content: Content | null = null;

            if (visionFiles.includes(file.type)) {
              const blob = await resizeImageBlob(file, 1920, 1920);
              const dataUrl = await readAsDataURL(blob);
              content = { type: "image", name: file.name, data: dataUrl } as ImageContent;
            } else if (canConvert(file)) {
              const text = await convertFileToText(file);
              content = { type: "text", text: `\`\`\`\`text\n// ${file.name}\n${text}\n\`\`\`\`` } as TextContent;
            }

            return { fileId, content };
          } catch (error) {
            console.error(`Error processing file ${file.name}:`, error);
            return { fileId, content: null };
          }
        }),
      );

      // Batch state updates
      const validContents = processedContents
        .filter(
          (result): result is PromiseFulfilledResult<{ fileId: string; content: TextContent | ImageContent }> =>
            result.status === "fulfilled" && result.value.content !== null,
        )
        .map((result) => result.value.content);

      setAttachments((prev) => [...prev, ...validContents]);
      setExtractingAttachments(new Set()); // Clear all at once
    },
    [config.vision?.files],
  );

  const isDragging = useDropZone(containerRef, handleFiles);

  // Force layout recalculation on mount to fix initial sizing issues
  useEffect(() => {
    if (containerRef.current) {
      // Force a repaint by reading offsetHeight
      void containerRef.current.offsetHeight;
    }
    if (contentInputRef.current) {
      void contentInputRef.current.offsetHeight;
    }
  }, []);

  // Auto-focus on desktop devices only (not on touch devices like iPad)
  useEffect(() => {
    if (messages.length === 0) {
      // Check if this is a touch device
      const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

      if (!isTouchDevice && contentInputRef.current) {
        // Small delay to ensure DOM is ready
        const timer = setTimeout(() => {
          contentInputRef.current?.focus();
        }, 100);

        return () => clearTimeout(timer);
      }
    }
  }, [messages.length]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // Prevent submission while responding
      if (isResponding) {
        return;
      }

      if (content.trim()) {
        let finalAttachments: Content[] = [...attachments];

        // If continuous capture is active, automatically capture current screen
        if (isContinuousCaptureActive) {
          try {
            const blob = await captureFrame();
            if (blob) {
              const dataUrl = await readAsDataURL(blob);
              const screenContent: ImageContent = {
                type: "image",
                name: `screen-capture-${Date.now()}.png`,
                data: dataUrl,
              };
              // Add screen capture as the first attachment
              finalAttachments = [screenContent, ...finalAttachments];
            }
          } catch (error) {
            console.error("Error capturing screen during message send:", error);
          }
        }

        const messageContent: Content[] = [{ type: "text", text: content }, ...finalAttachments];

        const message: Message = {
          role: Role.User,
          content: messageContent,
        };

        sendMessage(message);
        setContent("");
        setAttachments([]);
      }
    },
    [isResponding, content, attachments, isContinuousCaptureActive, captureFrame, sendMessage],
  );

  const handleAttachmentClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleDriveFiles = useCallback(
    async (files: SelectedFile[]) => {
      // Show extracting state for each file while downloading
      const names = files.map((f) => f.name);
      setExtractingAttachments((prev) => new Set([...prev, ...names]));

      try {
        const fetched = await Promise.all(
          files.map(async (f) => {
            const url = getDriveContentUrl(f.driveId, f.id);
            const resp = await fetch(url);
            const blob = await resp.blob();
            return new File([blob], f.name, { type: f.mime || blob.type });
          }),
        );

        handleFiles(fetched);
      } finally {
        setExtractingAttachments((prev) => {
          const next = new Set(prev);
          for (const n of names) next.delete(n);
          return next;
        });
      }
    },
    [handleFiles],
  );

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

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        handleFiles(Array.from(files));
        e.target.value = "";
      }
    },
    [handleFiles],
  );

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleContentChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && isResponding) {
        e.preventDefault();
        stopStreaming();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e as unknown as FormEvent);
      }
    },
    [handleSubmit, isResponding, stopStreaming],
  );

  // Handle transcription button click
  const handleTranscriptionClick = useCallback(async () => {
    if (isTranscribing) {
      setTranscribingContent(true);
      try {
        const text = await stopTranscription();
        if (text.trim()) {
          setContent(text);
        }
      } catch (error) {
        console.error("Transcription failed:", error);
      } finally {
        setTranscribingContent(false);
      }
    } else {
      try {
        await startTranscription();
      } catch (error) {
        console.error("Failed to start transcription:", error);
      }
    }
  }, [isTranscribing, stopTranscription, startTranscription]);

  useEffect(() => {
    if (!contentInputRef.current) {
      return;
    }

    contentInputRef.current.style.height = "auto";
    contentInputRef.current.style.height = `${contentInputRef.current.scrollHeight}px`;

    if (content.length === 0) {
      contentInputRef.current.style.height = "auto";
    }
  }, [content]);

  useEffect(() => {
    if (!voiceInputRef.current) {
      return;
    }

    voiceInputRef.current.style.height = "auto";
    voiceInputRef.current.style.height = `${voiceInputRef.current.scrollHeight}px`;

    if (voiceTextInput.length === 0) {
      voiceInputRef.current.style.height = "auto";
    }
  }, [voiceTextInput]);

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div
          ref={containerRef}
          className={`relative contain-[layout_style] will-change-[height] ${isDragging
            ? "border-2 border-dashed border-slate-400 dark:border-slate-500 bg-slate-50/80 dark:bg-slate-900/40 shadow-2xl shadow-slate-500/30 dark:shadow-slate-400/20 scale-[1.02] transition-all duration-200 rounded-lg md:rounded-2xl"
            : `border-0 md:border border-t border-solid border-neutral-200/60 dark:border-neutral-700/60 ${messages.length === 0 ? "bg-white/60 dark:bg-neutral-950/70" : "bg-white/30 dark:bg-neutral-950/50"
            } rounded-t-2xl md:rounded-2xl`
            } backdrop-blur-2xl flex flex-col min-h-16 md:min-h-12 shadow-sm transition-all duration-200`}
        >
          <input
            type="file"
            multiple
            accept={[...(config.vision?.files ?? []), ...acceptTypes()].join(",")}
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
          {(attachments.length > 0 || extractingAttachments.size > 0) && (
            <div className="p-3">
              <ChatInputAttachments
                attachments={attachments}
                extractingAttachments={extractingAttachments}
                onRemove={handleRemoveAttachment}
              />
            </div>
          )}

          {/* Input area */}
          <div className="relative flex-1">
            {isRealtimeSelected ? (
              <>
                <textarea
                  className="block w-full resize-none border-0 bg-transparent p-3 md:p-4 max-h-[40vh] overflow-y-auto min-h-10 whitespace-pre-wrap wrap-break-word text-neutral-800 dark:text-neutral-200 focus:outline-none"
                  style={{ scrollbarWidth: "thin", minHeight: "2.5rem", height: "auto" }}
                  ref={voiceInputRef}
                  value={voiceTextInput}
                  rows={1}
                  aria-label="Voice text input"
                  readOnly={!isListening}
                  onChange={(e) => isListening && setVoiceTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (isListening && e.key === "Enter" && !e.shiftKey && voiceTextInput.trim()) {
                      e.preventDefault();
                      sendVoiceText(voiceTextInput.trim());
                      setVoiceTextInput("");
                    }
                  }}
                />

                {isListening && !voiceTextInput && (
                  <div
                    className="absolute top-3 md:top-4 left-3 md:left-4 pointer-events-none flex items-center gap-2 text-neutral-500 dark:text-neutral-400"
                    aria-live="polite"
                  >
                    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/50 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                    </span>
                    <span className="text-sm">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">Listening</span>
                      <span className="text-neutral-500 dark:text-neutral-400"> — speak or type a message</span>
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <textarea
                  ref={contentInputRef}
                  className="block w-full resize-none border-0 bg-transparent p-3 md:p-4 max-h-[40vh] overflow-y-auto min-h-10 whitespace-pre-wrap wrap-break-word text-neutral-800 dark:text-neutral-200 focus:outline-none"
                  style={{
                    scrollbarWidth: "thin",
                    minHeight: "2.5rem",
                    height: "auto",
                  }}
                  value={content}
                  rows={1}
                  onChange={handleContentChange}
                  onKeyDown={handleKeyDown}
                  onPaste={async (e) => {
                    e.preventDefault();

                    const text = e.clipboardData.getData("text/plain");

                    const imageItems = Array.from(e.clipboardData.items)
                      .filter((item) => item.type.startsWith("image/"))
                      .map((item) => item.getAsFile())
                      .filter(Boolean) as File[];

                    const input = e.currentTarget;
                    const selectionStart = input.selectionStart ?? content.length;
                    const selectionEnd = input.selectionEnd ?? content.length;

                    if (text.trim()) {
                      const nextContent = `${content.slice(0, selectionStart)}${text}${content.slice(selectionEnd)}`;
                      setContent(nextContent);

                      requestAnimationFrame(() => {
                        const nextPosition = selectionStart + text.length;
                        input.setSelectionRange(nextPosition, nextPosition);
                      });
                    }

                    if (imageItems.length > 0) {
                      await handleFiles(imageItems);
                    }
                  }}
                  aria-label="Chat message input"
                />

                {/* CSS-animated placeholder */}
                {shouldShowPlaceholder && (
                  <div
                    className={`absolute top-3 md:top-4 left-3 md:left-4 pointer-events-none text-neutral-500 dark:text-neutral-400 transition-all duration-200 ${messages.length === 0 ? "typewriter-text" : ""}`}
                    style={
                      messages.length === 0
                        ? ({
                          "--text-length": placeholderText.length,
                          "--animation-duration": `${Math.max(1.5, placeholderText.length * 0.1)}s`,
                        } as React.CSSProperties & { "--text-length": number; "--animation-duration": string })
                        : {}
                    }
                  >
                    {placeholderText}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Controls */}
          <div className="relative flex items-center justify-between p-3 pt-0 pb-8 md:pb-3">
            {isRealtimeSelected && !isListening && (
              <button
                type="button"
                className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pb-10 group"
                onClick={startVoice}
              >
                <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 group-hover:bg-neutral-300 dark:group-hover:bg-neutral-600 group-hover:text-neutral-800 dark:group-hover:text-neutral-100 transition-all duration-200">
                  <Mic size={15} />
                </div>
                <span className="text-xs text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-700 dark:group-hover:text-neutral-200 transition-colors whitespace-nowrap">
                  Click to start voice conversation
                </span>
              </button>
            )}

            {isRealtimeSelected && isListening && (
              <div
                className="pointer-events-none absolute inset-0 p-3 pt-0 pb-8 md:pb-3 flex items-center justify-center"
                aria-hidden="true"
              >
                <div className="flex items-center gap-0.75 h-6">
                  {[
                    { id: "w1", freq: 1.7, phase: 0.0, minH: 3, maxH: 10 },
                    { id: "w2", freq: 2.3, phase: 0.6, minH: 4, maxH: 16 },
                    { id: "w3", freq: 1.5, phase: 1.1, minH: 5, maxH: 20 },
                    { id: "w4", freq: 2.8, phase: 0.3, minH: 5, maxH: 24 },
                    { id: "w5", freq: 1.5, phase: 1.4, minH: 5, maxH: 20 },
                    { id: "w6", freq: 2.1, phase: 0.9, minH: 4, maxH: 16 },
                    { id: "w7", freq: 1.8, phase: 0.2, minH: 3, maxH: 10 },
                  ].map(({ id, freq, phase, minH, maxH }) => {
                    const amp = Math.min(1, audioLevel * 5);
                    const range = (maxH - minH) * amp;
                    return (
                      <span
                        key={id}
                        className="w-0.75 rounded-full bg-neutral-500 dark:bg-neutral-400"
                        style={{
                          minHeight: `${minH}px`,
                          height: `${minH + range}px`,
                          opacity: 0.35 + amp * 0.65,
                          transition: "height 80ms ease-out, opacity 120ms ease-out",
                          animation: `waveBar ${(1 / freq).toFixed(2)}s ${phase.toFixed(2)}s ease-in-out infinite alternate`,
                          "--wave-min": `${minH}px`,
                          "--wave-max": `${minH + (maxH - minH) * Math.max(0.12, amp)}px`,
                        } as React.CSSProperties}
                      />
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              {voiceAvailable && !currentAgent?.model && messages.length === 0 && (
                <div
                  ref={modeSliderRef}
                  role="tablist"
                  aria-label="Input mode"
                  className="relative flex items-center gap-0.5 bg-neutral-200/50 dark:bg-neutral-800/50 backdrop-blur-sm rounded-full p-0.5 ring-1 ring-black/5 dark:ring-white/5"
                >
                  {/* Animated slider background */}
                  {modeSliderStyle.width > 0 && (
                    <div
                      className="absolute bg-white dark:bg-neutral-950 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-[left,width] duration-300 ease-out"
                      style={{
                        left: `${modeSliderStyle.left}px`,
                        width: `${modeSliderStyle.width}px`,
                        height: "calc(100% - 4px)",
                        top: "2px",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    data-mode="chat"
                    role="tab"
                    aria-selected={!isRealtimeSelected}
                    aria-label="Chat mode"
                    className={`relative z-10 flex items-center justify-start gap-1.5 py-1 pl-3 pr-3 text-xs font-medium rounded-full transition-colors duration-200 ${!isRealtimeSelected
                      ? "w-[4.5rem] text-neutral-900 dark:text-neutral-50"
                      : "w-9 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                      }`}
                    title="Chat mode"
                    onClick={() => isRealtimeSelected ? onModelChange(models[0]) : undefined}
                  >
                    <MessageSquare size={12} strokeWidth={2.25} className="shrink-0" />
                    {!isRealtimeSelected && <span>Chat</span>}
                  </button>
                  <button
                    type="button"
                    data-mode="voice"
                    role="tab"
                    aria-selected={isRealtimeSelected}
                    aria-label="Voice mode"
                    className={`relative z-10 flex items-center justify-end gap-1.5 py-1 pl-3 pr-3 text-xs font-medium rounded-full transition-colors duration-200 ${isRealtimeSelected
                      ? "w-[4.5rem] text-neutral-900 dark:text-neutral-50"
                      : "w-9 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                      }`}
                    title="Voice mode"
                    onClick={() =>
                      !isRealtimeSelected
                        ? onModelChange({ id: "realtime", name: "Voice Mode", description: "Real-time voice conversation" })
                        : undefined
                    }
                  >
                    {isRealtimeSelected && <span>Voice</span>}
                    <AudioLines size={12} strokeWidth={2.25} className="shrink-0" />
                  </button>
                </div>
              )}

              {currentAgent?.model ? (
                /* Agent overrides model — show agent badge instead of model selector */
                <div className="items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentAgent(null)}
                    className="flex group items-center gap-1 pl-1 pr-1.5 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors max-w-48"
                    title="Deselect agent"
                  >
                    <span className="shrink-0 w-3.5 flex justify-center relative">
                      <Bot size={14} className="transition-opacity group-hover:opacity-0" />
                      <X
                        size={14}
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity opacity-0 group-hover:opacity-100"
                      />
                    </span>
                    <span className="truncate min-w-0">{currentAgent.name}</span>
                  </button>
                </div>
              ) : (
                <>
                  {models.length > 0 && !isRealtimeSelected && (
                    <Menu>
                      <MenuButton className="flex items-center gap-1.5 pl-1 py-0 rounded-lg text-xs font-medium text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors max-w-48">
                        <span className="shrink-0 flex justify-center">{toolIndicator}</span>
                        <span className="truncate min-w-0">{model?.name ?? model?.id ?? "Select Model"}</span>
                      </MenuButton>
                      <MenuItems
                        modal={false}
                        transition
                        anchor="bottom start"
                        className="max-h-[50vh]! mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-hidden shadow-2xl shadow-black/40 dark:shadow-black/80 z-50 whitespace-nowrap dark:ring-1 dark:ring-white/10"
                      >
                        {models.filter((modelItem) => modelItem.id !== "realtime").map((modelItem) => (
                          <MenuItem key={modelItem.id}>
                            <button
                              type="button"
                              onClick={() => onModelChange(modelItem)}
                              title={modelItem.description}
                              className="group flex w-full flex-col items-start px-3 py-2 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10 last:border-b-0"
                            >
                              <div className="flex items-center gap-2.5 w-full">
                                <div className="shrink-0 w-3.5 flex justify-center">
                                  {model?.id === modelItem.id && (
                                    <Check size={14} className="text-neutral-600 dark:text-neutral-400" />
                                  )}
                                </div>
                                <div className="flex flex-col items-start flex-1 min-w-0">
                                  <div className="font-semibold text-sm leading-tight whitespace-nowrap">
                                    {modelItem.name ?? modelItem.id}
                                  </div>
                                  {modelItem.description && (
                                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 text-left leading-snug opacity-90">
                                      {modelItem.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </button>
                          </MenuItem>
                        ))}

                      </MenuItems>
                    </Menu>
                  )}

                  {currentAgent && (
                    <button
                      type="button"
                      onClick={() => setCurrentAgent(null)}
                      className="hidden lg:flex group items-center gap-1 pl-2 pr-1.5 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors"
                      title="Deselect agent"
                    >
                      <span className="shrink-0 w-3.5 flex justify-center relative">
                        <Bot size={14} className="transition-opacity group-hover:opacity-0" />
                        <X
                          size={14}
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity opacity-0 group-hover:opacity-100"
                        />
                      </span>
                      <span className="max-w-20 truncate">{currentAgent.name}</span>
                    </button>
                  )}
                </>
              )}

            </div>

            <div className="flex items-center gap-2 md:gap-1 min-h-7">
              {/* Features - Show inline buttons for 2 or fewer providers, otherwise show menu */}
              {visibleProviders.length > 0 && visibleProviders.length <= 2 ? (
                // Inline toggle buttons for 2 or fewer providers
                visibleProviders.map((provider: ToolProvider) => {
                  const icon = provider.icon || Sparkles;
                  const state = getProviderState(provider.id);
                  const providerEnabled = state === ProviderState.Connected;
                  const providerInitializing = state === ProviderState.Initializing;
                  const providerFailed = state === ProviderState.Failed;

                  const renderIcon = () => {
                    if (providerInitializing) return <LoaderCircle size={14} className="animate-spin" />;
                    if (providerFailed) return <TriangleAlert size={14} />;
                    if (typeof icon === "string")
                      return (
                        <span
                          className="shrink-0 bg-current inline-block"
                          style={{
                            width: 14,
                            height: 14,
                            maskImage: `url(${icon})`,
                            WebkitMaskImage: `url(${icon})`,
                            maskSize: "contain",
                            maskRepeat: "no-repeat",
                            maskPosition: "center",
                          }}
                        />
                      );
                    const Icon = icon;
                    return <Icon size={14} />;
                  };

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={`p-2.5 md:p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 disabled:opacity-50 ${providerEnabled
                        ? "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 bg-blue-100/80 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 rounded-lg"
                        : "text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                        }`}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (providerInitializing) return;
                        try {
                          await setProviderEnabled(provider.id, !providerEnabled);
                        } catch (error) {
                          console.error(`Failed to toggle provider ${provider.name}:`, error);
                        }
                      }}
                      disabled={providerInitializing}
                      title={
                        providerFailed
                          ? `${provider.name} - Failed to connect (click to retry)`
                          : providerEnabled
                            ? `${provider.name} - Click to disable`
                            : `${provider.name} - Click to enable`
                      }
                    >
                      {renderIcon()}
                    </button>
                  );
                })
              ) : visibleProviders.length > 2 ? (
                // Menu for more than 2 providers
                <Menu>
                  <MenuButton
                    className="p-2.5 md:p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                    title="Features"
                  >
                    <Sliders size={16} />
                  </MenuButton>
                  <MenuItems
                    modal={false}
                    transition
                    anchor="bottom end"
                    className="mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-hidden shadow-2xl shadow-black/40 dark:shadow-black/80 z-50 min-w-52 dark:ring-1 dark:ring-white/10 max-h-[60vh] overflow-y-auto"
                  >
                    {visibleProviders.map((provider: ToolProvider) => {
                      const icon = provider.icon || Sparkles;
                      const state = getProviderState(provider.id);
                      const providerEnabled = state === ProviderState.Connected;
                      const providerInitializing = state === ProviderState.Initializing;
                      const providerFailed = state === ProviderState.Failed;

                      const renderIcon = () => {
                        if (typeof icon === "string")
                          return (
                            <span
                              className="shrink-0 bg-current inline-block"
                              style={{
                                width: 16,
                                height: 16,
                                maskImage: `url(${icon})`,
                                WebkitMaskImage: `url(${icon})`,
                                maskSize: "contain",
                                maskRepeat: "no-repeat",
                                maskPosition: "center",
                              }}
                            />
                          );
                        const Icon = icon;
                        return <Icon size={16} />;
                      };

                      return (
                        <MenuItem key={provider.id}>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              try {
                                await setProviderEnabled(provider.id, !providerEnabled);
                              } catch (error) {
                                console.error(`Failed to toggle provider ${provider.name}:`, error);
                              }
                            }}
                            disabled={providerInitializing}
                            className={`group flex w-full items-center justify-between px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10 last:border-b-0 disabled:opacity-50`}
                          >
                            <div className="flex items-center gap-3">
                              {renderIcon()}
                              <div className="flex flex-col items-start">
                                <span className="font-medium text-sm">{provider.name}</span>
                                {provider.description && (
                                  <span className="text-xs text-neutral-600 dark:text-neutral-400">
                                    {provider.description}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pl-2">
                              {providerInitializing ? (
                                <LoaderCircle
                                  size={16}
                                  className="animate-spin text-neutral-600 dark:text-neutral-400"
                                />
                              ) : providerFailed ? (
                                <TriangleAlert
                                  size={16}
                                  className="text-neutral-600 dark:text-neutral-400"
                                  strokeWidth={2.5}
                                />
                              ) : providerEnabled ? (
                                <Check
                                  size={16}
                                  className="text-neutral-800 dark:text-neutral-200"
                                  strokeWidth={2.5}
                                />
                              ) : (
                                <div className="w-4 h-4" />
                              )}
                            </div>
                          </button>
                        </MenuItem>
                      );
                    })}
                  </MenuItems>
                </Menu>
              ) : null}

              {!isRealtimeSelected && (
                <>
                  {isScreenCaptureAvailable && (
                    <button
                      type="button"
                      className={`p-2.5 md:p-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${isContinuousCaptureActive
                        ? "text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200 bg-red-100/80 dark:bg-red-900/40 border border-red-200 dark:border-red-800 rounded-lg"
                        : "text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                        }`}
                      onClick={handleContinuousCaptureToggle}
                      title={
                        isContinuousCaptureActive ? "Stop continuous screen capture" : "Start continuous screen capture"
                      }
                    >
                      <ScreenShare size={14} />
                      {isContinuousCaptureActive && <span className="hidden sm:inline">Capturing</span>}
                    </button>
                  )}

                  {config.drives.length > 0 ? (
                    <Menu>
                      <MenuButton className="p-2.5 md:p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
                        <Paperclip size={16} />
                      </MenuButton>
                      <MenuItems
                        modal={false}
                        transition
                        anchor="bottom end"
                        className="mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-hidden shadow-2xl shadow-black/40 dark:shadow-black/80 z-50 min-w-48 dark:ring-1 dark:ring-white/10"
                      >
                        <MenuItem>
                          <button
                            type="button"
                            onClick={handleAttachmentClick}
                            className="group flex w-full items-center gap-3 px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10"
                          >
                            <Paperclip size={16} />
                            <span className="font-medium text-sm">Upload</span>
                          </button>
                        </MenuItem>
                        {config.drives.map((fp) => (
                          <MenuItem key={fp.id}>
                            <button
                              type="button"
                              onClick={() => setActiveDrive(fp)}
                              className="group flex w-full items-center gap-3 px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10 last:border-b-0"
                            >
                              {fp.icon ? (
                                <span
                                  className="shrink-0 bg-current inline-block"
                                  style={{
                                    width: 16,
                                    height: 16,
                                    maskImage: `url(${fp.icon})`,
                                    WebkitMaskImage: `url(${fp.icon})`,
                                    maskSize: "contain",
                                    maskRepeat: "no-repeat",
                                    maskPosition: "center",
                                  }}
                                />
                              ) : (
                                <HardDrive size={16} />
                              )}
                              <span className="font-medium text-sm">{fp.name}</span>
                            </button>
                          </MenuItem>
                        ))}
                      </MenuItems>
                    </Menu>
                  ) : (
                    <button
                      type="button"
                      className="p-2.5 md:p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                      onClick={handleAttachmentClick}
                    >
                      <Paperclip size={16} />
                    </button>
                  )}
                </>
              )}

              {/* Dynamic Send/Mic/Voice/Loading Button */}
              {isRealtimeSelected ? (
                isListening ? (
                  <>
                    {voiceTextInput.trim() && (
                      <button
                        type="button"
                        className="p-2.5 md:p-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                        onClick={() => {
                          sendVoiceText(voiceTextInput.trim());
                          setVoiceTextInput("");
                        }}
                        title="Send text"
                      >
                        <Send size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-800 dark:hover:text-neutral-200 transition-all text-xs font-medium"
                      onClick={async () => {
                        await stopVoice();
                      }}
                      title="Stop voice mode"
                    >
                      <Square size={12} />
                      <span>Stop</span>
                    </button>
                  </>
                ) : (
                  null
                )
              ) : isResponding ? (
                <button
                  type="button"
                  className="group/stop p-2.5 md:p-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                  onClick={stopStreaming}
                  title="Stop generating (Esc)"
                >
                  <LoaderCircle size={16} className="animate-spin group-hover/stop:hidden" />
                  <Square size={16} className="hidden group-hover/stop:block" />
                </button>
              ) : content.trim() ? (
                <button
                  className="p-2.5 md:p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                  type="submit"
                >
                  <Send size={16} />
                </button>
              ) : canTranscribe && !isListening ? (
                transcribingContent ? (
                  <button
                    type="button"
                    className="p-2.5 md:p-1.5 text-neutral-600 dark:text-neutral-400"
                    disabled
                    title="Processing audio..."
                  >
                    <Loader2 size={16} className="animate-spin" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`p-2.5 md:p-1.5 transition-colors ${isTranscribing
                      ? "text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                      : "text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                      }`}
                    onClick={handleTranscriptionClick}
                    title={isTranscribing ? "Stop recording" : "Start recording"}
                    disabled={isResponding}
                  >
                    {isTranscribing ? <Square size={16} /> : <Mic size={16} />}
                  </button>
                )
              ) : (
                <button
                  className="p-2.5 md:p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                  type="submit"
                  disabled={isResponding}
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      {activeDrive && (
        <DrivePicker
          isOpen={!!activeDrive}
          onClose={() => setActiveDrive(null)}
          drive={activeDrive}
          onFilesSelected={handleDriveFiles}
          multiple
          accept={[...(config.vision?.files ?? []), ...acceptTypes()].join(",")}
        />
      )}
    </>
  );
}
