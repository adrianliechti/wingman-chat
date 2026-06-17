import {
  AudioLines,
  Bot,
  Loader2,
  LoaderCircle,
  Mic,
  Rocket,
  ScreenShare,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { processUploadedFile } from "@/features/artifacts/lib/artifacts";
import { useChat } from "@/features/chat/hooks/useChat";
import { chatAcceptString, useFileAttachments } from "@/features/chat/hooks/useFileAttachments";
import { getSavedModelId } from "@/features/chat/hooks/useModels";
import { useScreenCapture } from "@/features/chat/hooks/useScreenCapture";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { useTranscription } from "@/features/voice/hooks/useTranscription";
import { useVoice } from "@/features/voice/hooks/useVoice";
import { getConfig } from "@/shared/config";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { cn } from "@/shared/lib/cn";
import { getDriveContentUrl } from "@/shared/lib/drives";
import { notify } from "@/shared/lib/notify";
import { readAsDataURL } from "@/shared/lib/utils";
import type { Content, ImageContent, Message, TextContent, ToolProvider } from "@/shared/types/chat";
import { ProviderState, Role } from "@/shared/types/chat";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { ModelDropdown } from "@/shared/ui/ModelDropdown";
import { Tooltip } from "@/shared/ui/Tooltip";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";
import { ChatInputAddMenu } from "./ChatInputAddMenu";
import { ChatInputAttachments } from "./ChatInputAttachments";
import { formatArtifactReference } from "./chatMessageUtils";

export function ChatInput() {
  const config = getConfig();

  const { sendMessage, models, model, setModel: onModelChange, messages, isResponding, stopStreaming } = useChat();
  const { currentAgent, setCurrentAgent, setShowAgentDrawer } = useAgents();
  const { isAvailable: artifactsAvailable } = useArtifacts();
  const { profile } = useSettings();
  const {
    isAvailable: isScreenCaptureAvailable,
    isActive: isContinuousCaptureActive,
    startCapture,
    stopCapture,
    captureFrame,
  } = useScreenCapture();
  const {
    providers,
    getProviderState,
    getProviderPolicy,
    setProviderEnabled,
    setModelOverrides,
    skillSources,
    setSkillSources,
  } = useToolsContext();
  const {
    isAvailable: voiceAvailable,
    isListening,
    isConnecting,
    audioLevel,
    startVoice,
    stopVoice,
    sendText: sendVoiceText,
  } = useVoice();
  const { inputDeviceId, inputDevices, setInputDevice, requestPermission: requestAudioPermission } = useAudioDevices();

  // Track if realtime mode model is selected (either via model picker or agent's model)
  const isRealtimeSelected = model?.id === "realtime" || currentAgent?.model === "realtime";

  // Request mic permission once per voice-mode entry so the device selector shows real names.
  const permissionRequestedRef = useRef(false);
  useEffect(() => {
    if (!isRealtimeSelected || !voiceAvailable) {
      permissionRequestedRef.current = false;
      return;
    }
    if (inputDevices.length === 0 && !permissionRequestedRef.current) {
      permissionRequestedRef.current = true;
      void requestAudioPermission();
    }
  }, [isRealtimeSelected, voiceAvailable, inputDevices.length, requestAudioPermission]);

  // Auto-start voice when entering via the mode toggle (not via a realtime agent).
  // Attempt once per entry to avoid a retry loop if startVoice() fails.
  const isRealtimeViaToggle = model?.id === "realtime" && currentAgent?.model !== "realtime";
  const autoStartAttemptedRef = useRef(false);
  useEffect(() => {
    if (!isRealtimeViaToggle || !voiceAvailable) {
      autoStartAttemptedRef.current = false;
      return;
    }
    if (!isListening && !autoStartAttemptedRef.current) {
      autoStartAttemptedRef.current = true;
      void startVoice();
    }
  }, [isRealtimeViaToggle, voiceAvailable, isListening, startVoice]);

  const [content, setContent] = useState("");
  const [transcribingContent, setTranscribingContent] = useState(false);
  const [voiceTextInput, setVoiceTextInput] = useState("");

  const {
    attachments,
    pendingFiles,
    extractingAttachments,
    setExtractingAttachments,
    setPendingFiles,
    handleFiles,
    clearAttachments,
    removeAttachment,
  } = useFileAttachments({
    visionFiles: config.vision?.files ?? [],
    artifactsAvailable,
    visionMaxFileSize: config.vision?.maxFileSize,
    artifactsMaxFileSize: config.artifacts?.maxFileSize,
  });

  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentInputRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const profileName = profile?.name;

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

  // Accept-attribute kept in sync with the intake rule in `useFileAttachments`:
  // images always; any file when the artifacts workspace can hold it.
  const acceptString = useMemo(
    () => chatAcceptString(config.vision?.files ?? [], artifactsAvailable),
    [config.vision?.files, artifactsAvailable],
  );

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

  // Providers visible in the UI: exclude model-configured and artifacts. Shown in
  // agent mode too — the agent's required tools render locked, optionals toggle.
  const visibleProviders = useMemo(
    () => providers.filter((p: ToolProvider) => p.id !== "artifacts" && !modelTools.has(p.id)),
    [providers, modelTools],
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
      const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;

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

        // Process pending document attachments into artifact files now (at send).
        // `sendMessage` writes them into the chat's workspace once it exists.
        const artifactFiles = (
          await Promise.all(
            pendingFiles.map(async (file) => {
              try {
                return await processUploadedFile(file);
              } catch (error) {
                console.error(`Failed to process attachment ${file.name}:`, error);
                return [];
              }
            }),
          )
        ).flat();

        // Tell the model which files are available in the artifacts workspace so
        // it reads them. The UI renders this line back as clickable chips.
        if (artifactFiles.length > 0) {
          const reference: TextContent = {
            type: "text",
            text: formatArtifactReference(artifactFiles.map((f) => f.path)),
          };
          messageContent.push(reference);
        }

        const message: Message = {
          role: Role.User,
          content: messageContent,
        };

        sendMessage(message, undefined, artifactFiles.length > 0 ? artifactFiles : undefined);
        setContent("");
        clearAttachments();
      }
    },
    [
      isResponding,
      content,
      attachments,
      pendingFiles,
      isContinuousCaptureActive,
      captureFrame,
      sendMessage,
      clearAttachments,
    ],
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
    [handleFiles, setExtractingAttachments],
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

  const handleRemoveAttachment = useCallback(
    (index: number) => {
      removeAttachment(index);
    },
    [removeAttachment],
  );

  const handleRemovePendingFile = useCallback(
    (index: number) => {
      // Nothing is written to artifacts until send, so removing just drops it.
      setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    },
    [setPendingFiles],
  );

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
        notify.error("Transcription failed", "The recording couldn't be transcribed. Please try again.");
      } finally {
        setTranscribingContent(false);
      }
    } else {
      try {
        await startTranscription();
      } catch (error) {
        console.error("Failed to start transcription:", error);
        notify.error("Couldn't start recording", "Check your microphone access and try again.");
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
          className={`relative @container contain-[layout_style] will-change-[height] ${
            isDragging
              ? "border-2 border-dashed border-slate-400 dark:border-slate-500 bg-slate-50/80 dark:bg-slate-900/40 shadow-2xl shadow-slate-500/30 dark:shadow-slate-400/20 scale-[1.02] transition-all duration-200 rounded-lg md:rounded-2xl"
              : `border border-solid border-neutral-200/60 dark:border-neutral-700/60 bg-white/60 dark:bg-neutral-950/70 rounded-2xl md:rounded-2xl`
          } backdrop-blur-2xl flex flex-col min-h-16 md:min-h-12 shadow-sm transition-all duration-200`}
        >
          <input
            type="file"
            multiple
            accept={acceptString}
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Drop zone overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-linear-to-r from-slate-500/20 via-slate-600/30 to-slate-500/20 dark:from-slate-400/20 dark:via-slate-500/30 dark:to-slate-400/20 md:rounded-2xl flex flex-col items-center justify-center pointer-events-none z-10 backdrop-blur-xl">
              <div className="text-slate-700 dark:text-slate-300 font-semibold text-lg text-center">
                Drop files here
              </div>
              <div className="text-slate-600 dark:text-slate-400 text-sm mt-1 text-center">
                Images, documents, and text files supported
              </div>
            </div>
          )}

          {/* Attachments display */}
          {(attachments.length > 0 || pendingFiles.length > 0 || extractingAttachments.size > 0) && (
            <div className={cn("p-3 transition-all duration-200", isDragging && "blur-sm")}>
              <ChatInputAttachments
                attachments={attachments}
                artifactAttachments={pendingFiles.map((f) => f.name)}
                extractingAttachments={extractingAttachments}
                onRemove={handleRemoveAttachment}
                onRemoveArtifact={handleRemovePendingFile}
              />
            </div>
          )}

          {/* Input area */}
          <div className={cn("relative flex-1 transition-all duration-200", isDragging && "blur-sm")}>
            {isRealtimeSelected ? (
              <textarea
                className="block w-full resize-none border-0 bg-transparent p-3 md:p-4 max-h-[40vh] overflow-y-auto min-h-10 whitespace-pre-wrap wrap-break-word text-neutral-800 dark:text-neutral-200 focus:outline-none"
                style={{ scrollbarWidth: "thin", minHeight: "2.5rem", height: "auto" }}
                ref={voiceInputRef}
                value={voiceTextInput}
                rows={1}
                aria-label="Voice text input"
                inputMode="text"
                enterKeyHint="send"
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
                  inputMode="text"
                  enterKeyHint="send"
                  onChange={handleContentChange}
                  onKeyDown={handleKeyDown}
                  onPaste={async (e) => {
                    e.preventDefault();

                    const text = e.clipboardData.getData("text/plain");

                    // Any pasted file (image, doc, media, …) routes to handleFiles,
                    // which decides inline-vision vs artifacts. Read synchronously —
                    // clipboard items are only valid during the event.
                    const fileItems = Array.from(e.clipboardData.items)
                      .filter((item) => item.kind === "file")
                      .map((item) => item.getAsFile())
                      .filter(Boolean) as File[];

                    // A pasted file may also expose a text/plain representation (e.g.
                    // an OS file copy yields the filename) — don't pollute the textarea.
                    if (fileItems.length > 0) {
                      await handleFiles(fileItems);
                      return;
                    }

                    if (text.trim()) {
                      const input = e.currentTarget;
                      const selectionStart = input.selectionStart ?? content.length;
                      const selectionEnd = input.selectionEnd ?? content.length;
                      const nextContent = `${content.slice(0, selectionStart)}${text}${content.slice(selectionEnd)}`;
                      setContent(nextContent);

                      requestAnimationFrame(() => {
                        const nextPosition = selectionStart + text.length;
                        input.setSelectionRange(nextPosition, nextPosition);
                      });
                    }
                  }}
                  aria-label="Chat message input"
                />

                {/* CSS-animated placeholder */}
                {shouldShowPlaceholder && (
                  <div
                    className={cn(
                      "absolute top-3 md:top-4 left-3 md:left-4 pointer-events-none text-neutral-500 dark:text-neutral-400 transition-all duration-200",
                      messages.length === 0 && "typewriter-text",
                    )}
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
          <div
            className={cn(
              "relative flex items-center justify-between p-3 pt-0 pb-3 transition-all duration-200",
              isDragging && "blur-sm",
            )}
          >
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
                        style={
                          {
                            minHeight: `${minH}px`,
                            height: `${minH + range}px`,
                            opacity: 0.35 + amp * 0.65,
                            transition: "height 80ms ease-out, opacity 120ms ease-out",
                            animation: `waveBar ${(1 / freq).toFixed(2)}s ${phase.toFixed(2)}s ease-in-out infinite alternate`,
                            "--wave-min": `${minH}px`,
                            "--wave-max": `${minH + (maxH - minH) * Math.max(0.12, amp)}px`,
                          } as React.CSSProperties
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              {/* Listening hint — bottom row, left side */}
              {isRealtimeSelected && isListening && !voiceTextInput && (
                <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400" aria-live="polite">
                  <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/50 animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                  </span>
                  <span className="text-xs">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      {currentAgent?.name ?? "Listening"}
                    </span>
                    <span className="text-neutral-500 dark:text-neutral-400"> — speak or type a message</span>
                  </span>
                </div>
              )}
              {!isRealtimeSelected && (
                <ChatInputAddMenu
                  isScreenCaptureAvailable={isScreenCaptureAvailable}
                  isContinuousCaptureActive={isContinuousCaptureActive}
                  canTranscribe={canTranscribe}
                  isTranscribing={isTranscribing}
                  isResponding={isResponding}
                  visibleProviders={visibleProviders}
                  getProviderState={getProviderState}
                  getProviderPolicy={getProviderPolicy}
                  setProviderEnabled={setProviderEnabled}
                  skillSources={skillSources}
                  setSkillSources={setSkillSources}
                  onAttachmentClick={handleAttachmentClick}
                  onContinuousCaptureToggle={handleContinuousCaptureToggle}
                  onTranscriptionClick={handleTranscriptionClick}
                  onDriveSelect={setActiveDrive}
                />
              )}
              {/* Model selector */}
              {models.length > 0 && !isRealtimeSelected && !currentAgent && (
                <ModelDropdown
                  models={models}
                  value={model?.id ?? ""}
                  onChange={(modelId) => {
                    const m = models.find((m) => m.id === modelId);
                    if (m) onModelChange(m);
                  }}
                  dropdownClassName="w-auto min-w-48 whitespace-nowrap"
                  trigger={({ onClick, onPointerDownCapture }) => (
                    <button
                      type="button"
                      onClick={onClick}
                      onPointerDownCapture={onPointerDownCapture}
                      className="flex items-center gap-1.5 pl-1 py-0 rounded-lg text-xs font-medium text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors max-w-48"
                    >
                      <Tooltip content="Switch model" side="bottom" className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0 flex justify-center">{toolIndicator}</span>
                        <span className="truncate min-w-0">{model?.name ?? model?.id ?? "Select Model"}</span>
                      </Tooltip>
                    </button>
                  )}
                />
              )}

              {/* Agent picker — combined trigger + active-agent badge (hidden when listening, agent name shown in hint) */}
              {currentAgent && !(isRealtimeSelected && isListening) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setCurrentAgent(null);
                    setShowAgentDrawer(false);
                  }}
                  className="group flex items-center gap-1 pl-1 pr-1.5 py-1 rounded-lg text-xs font-medium transition-colors text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  title="Deselect agent"
                >
                  <span className="shrink-0 w-3.5 flex justify-center relative">
                    <Bot size={14} className="transition-opacity group-hover:opacity-0" />
                    <X
                      size={14}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity opacity-0 group-hover:opacity-100"
                    />
                  </span>
                  <span className="truncate max-w-28">{currentAgent.name}</span>
                </button>
              )}
              {/* Screen share active indicator */}
              {!isRealtimeSelected && isContinuousCaptureActive && (
                <button
                  type="button"
                  onClick={stopCapture}
                  className="group flex items-center gap-1 pl-1 pr-1.5 py-1 rounded-lg text-xs font-medium transition-colors text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                  title="Stop screen sharing"
                >
                  <span className="shrink-0 w-3.5 flex justify-center relative">
                    <ScreenShare size={14} className="transition-opacity group-hover:opacity-0" />
                    <X
                      size={14}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity opacity-0 group-hover:opacity-100"
                    />
                  </span>
                  <span>Sharing</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 md:gap-1 min-h-9 md:min-h-7">
              {/* Dynamic Send/Mic/Voice/Loading Button */}
              {isRealtimeSelected ? (
                <>
                  {isListening && voiceTextInput.trim() ? (
                    // When the user has typed text during a live session, show the
                    // Send action in the microphone selector's slot.
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
                  ) : (
                    voiceAvailable && (
                      <DropdownMenu
                        anchor="bottom start"
                        panelClassName="max-h-[50vh]! min-w-52"
                        trigger={
                          <MenuButton
                            className="flex items-center gap-1.5 pl-1 pr-2 py-0 mr-1 rounded-lg text-xs font-medium text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors max-w-48"
                            title="Select microphone"
                            aria-label="Select microphone"
                          >
                            <span className="shrink-0 flex justify-center">
                              <Mic size={14} />
                            </span>
                            <span className="hidden @md:inline truncate min-w-0">
                              {(() => {
                                const selected = inputDevices.find((d) => d.deviceId === inputDeviceId);
                                if (selected) return selected.label || "Microphone";
                                return "Default Mic";
                              })()}
                            </span>
                          </MenuButton>
                        }
                      >
                        {inputDevices.length === 0 ? (
                          <DropdownMenuItem
                            icon={<Mic size={14} className="shrink-0" />}
                            onClick={() => {
                              void requestAudioPermission();
                            }}
                          >
                            Allow microphone access
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuItem onClick={() => setInputDevice(undefined)}>
                              System Default
                            </DropdownMenuItem>
                            {inputDevices.map((device) => (
                              <DropdownMenuItem key={device.deviceId} onClick={() => setInputDevice(device.deviceId)}>
                                {device.label || `Microphone (${device.deviceId.slice(0, 8)})`}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                      </DropdownMenu>
                    )
                  )}
                  {isConnecting && !isListening ? (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors text-xs font-medium"
                      title="Cancel connecting"
                      onClick={async () => {
                        await stopVoice();
                        const savedId = getSavedModelId();
                        const restored = (savedId && models.find((m) => m.id === savedId)) || models[0];
                        onModelChange(restored ?? null);
                      }}
                    >
                      <LoaderCircle size={12} className="animate-spin" />
                      <span>Cancel</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors text-xs font-medium"
                      onClick={async () => {
                        if (!isListening) {
                          await startVoice();
                          return;
                        }
                        await stopVoice();
                        const savedId = getSavedModelId();
                        const restored = (savedId && models.find((m) => m.id === savedId)) || models[0];
                        onModelChange(restored ?? null);
                      }}
                    >
                      {isListening ? (
                        <>
                          <Square size={12} />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <AudioLines size={12} />
                          <span>Start audio</span>
                        </>
                      )}
                    </button>
                  )}
                </>
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
                ) : isTranscribing ? (
                  // Recording in progress — show stop button on all devices
                  <button
                    type="button"
                    className="p-2.5 md:p-1.5 transition-colors text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                    onClick={handleTranscriptionClick}
                    title="Stop recording"
                    disabled={isResponding}
                  >
                    <Square size={16} />
                  </button>
                ) : (
                  // Not yet recording — desktop shows dictate mic + voice-mode wave; mobile uses the + menu and wave
                  <>
                    <Tooltip content="Start dictate" side="bottom" className="hidden md:block">
                      <button
                        type="button"
                        className="p-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                        onClick={handleTranscriptionClick}
                        disabled={isResponding}
                      >
                        <Mic size={16} />
                      </button>
                    </Tooltip>
                    {voiceAvailable && !currentAgent?.model ? (
                      <Tooltip content="Voice mode" side="bottom">
                        <button
                          type="button"
                          className="p-2.5 md:p-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                          onClick={() =>
                            onModelChange({
                              id: "realtime",
                              name: "Voice Mode",
                              description: "Real-time voice conversation",
                            })
                          }
                          title="Voice mode"
                          aria-label="Start voice mode"
                        >
                          <AudioLines size={16} />
                        </button>
                      </Tooltip>
                    ) : (
                      <button
                        className="md:hidden p-2.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                        type="submit"
                        disabled={isResponding}
                      >
                        <Send size={16} />
                      </button>
                    )}
                  </>
                )
              ) : voiceAvailable && !currentAgent?.model ? (
                <Tooltip content="Voice mode" side="bottom">
                  <button
                    type="button"
                    className="p-2.5 md:p-1.5 transition-colors text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                    onClick={() =>
                      onModelChange({
                        id: "realtime",
                        name: "Voice Mode",
                        description: "Real-time voice conversation",
                      })
                    }
                    title="Voice mode"
                    aria-label="Start voice mode"
                  >
                    <AudioLines size={16} />
                  </button>
                </Tooltip>
              ) : (
                <span className="p-2.5 md:p-1.5 text-neutral-400 dark:text-neutral-500">
                  <AudioLines size={16} />
                </span>
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
          accept={acceptString}
        />
      )}
    </>
  );
}
