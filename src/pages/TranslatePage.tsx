import { useEffect, useRef, useState, useCallback } from "react";
import { useDropZone } from "../hooks/useDropZone";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { PilcrowRightIcon, Loader2, PlusIcon, GlobeIcon, FileIcon, UploadIcon, XIcon, DownloadIcon, ThermometerIcon, SwatchBookIcon, AlertCircle, ChevronDown, ChevronRight, SparklesIcon } from "lucide-react";
import { useNavigation } from "../hooks/useNavigation";
import { useLayout } from "../hooks/useLayout";
import { useTranslate } from "../hooks/useTranslate";
import { CopyButton } from "../components/CopyButton";
import { PlayButton } from "../components/PlayButton";
import { RewritePopover } from "../components/RewritePopover";
import { InteractiveText } from "../components/InteractiveText";
import { downloadFromUrl } from "../lib/utils";
import { getConfig } from "../config";

export function TranslatePage() {
  const { setRightActions } = useNavigation();
  const { layoutMode } = useLayout();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Rewrite menu state
  const [rewriteMenu, setRewriteMenu] = useState<{
    selectedText: string;
    selectionStart: number;
    selectionEnd: number;
    position: { x: number; y: number };
  } | null>(null);

  // Prompt overlay state
  const [promptText, setPromptText] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  
  const config = getConfig();
  const enableTTS = config.tts;
  
  // Use translate context
  const {
    sourceText,
    translatedText,
    tone,
    style,
    isLoading,
    error,
    supportedLanguages,
    selectedLanguage,
    selectedFile,
    translatedFileUrl,
    translatedFileName,
    supportedFiles,
    toneOptions,
    styleOptions,
    setSourceText,
    setTargetLang,
    setTone,
    setStyle,
    performTranslate,
    handleReset,
    selectFile,
    clearFile
  } = useTranslate();

  // Local state for editable translated text (to allow rewriting)
  const [currentText, setCurrentText] = useState(translatedText);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const lastSelectionRef = useRef<string>('');

  // Update editable text when translated text changes
  useEffect(() => {
    setCurrentText(translatedText);
  }, [translatedText]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Get allowed MIME types from supported files
      const allowedMimeTypes = supportedFiles.map(sf => sf.mime);
      
      if (allowedMimeTypes.length === 0) {
        // If no supported files, don't allow file selection
        return;
      }
      
      if (allowedMimeTypes.includes(file.type)) {
        selectFile(file);
      } else {
        const supportedExtensions = supportedFiles.map(sf => sf.ext).join(', ');
        alert(`Please select a valid file type: ${supportedExtensions}`);
      }
    }
  };

  const handleFileUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileClear = () => {
    clearFile();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDropFiles = (files: File[]) => {
    const allowedMimeTypes = supportedFiles.map(sf => sf.mime);
    
    if (allowedMimeTypes.length === 0) {
      // If no supported files, don't allow file drop
      return;
    }
    
    const file = files.find(f => allowedMimeTypes.includes(f.type));
    if (file) {
      selectFile(file);
    } else {
      const supportedExtensions = supportedFiles.map(sf => sf.ext).join(', ');
      alert(`Please drop a valid file type: ${supportedExtensions}`);
    }
  };

  const isDragging = useDropZone(containerRef, handleDropFiles);

  const handleDownload = () => {
    if (translatedFileUrl && translatedFileName) {
      downloadFromUrl(translatedFileUrl, translatedFileName);
    }
  };

  // Handle text selection for rewriting
  const handleTextSelect = useCallback((selectedText: string, position: { x: number; y: number }, positionStart: number, positionEnd: number) => {
    if (!selectedText.trim() || selectedText.length < 1) return;
    
    // Prevent duplicate selections
    const selectionKey = `${selectedText}-${positionStart}-${positionEnd}`;
    if (lastSelectionRef.current === selectionKey) return;
    lastSelectionRef.current = selectionKey;
    
    // Close existing menu first
    setRewriteMenu(null);
    
    // Short delay to prevent visual glitches
    setTimeout(() => {
      setRewriteMenu({
        selectedText: selectedText.trim(),
        selectionStart: positionStart,
        selectionEnd: positionEnd,
        position: position
      });
    }, 50);
  }, []);

  const handleSelect = (alternative: string, contextToReplace: string) => {
    if (rewriteMenu && currentText) {
      // Replace the entire context with the alternative instead of just the selected text
      const newText = currentText.replace(contextToReplace, alternative);
      setCurrentText(newText);
    }
    setRewriteMenu(null);
  };

  const closeRewriteMenu = () => {
    setRewriteMenu(null);
    setPreviewText(null); // Clear preview when closing menu
    lastSelectionRef.current = ''; // Clear last selection to allow clicking the same word again
  };

  const handlePreview = (previewText: string | null) => {
    setPreviewText(previewText);
  };

  const handlePromptSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!promptText.trim() || !currentText.trim() || isPromptLoading || !selectedLanguage) return;

    setIsPromptLoading(true);
    setPromptError(null);

    try {
      const result = await config.client.rewriteText(
        config.translator.model || '',
        currentText,
        selectedLanguage.code,
        undefined, // tone
        undefined, // style
        promptText.trim() // userPrompt
      );
      
      if (result) {
        setCurrentText(result);
        setPromptText(""); // Clear the prompt input after successful rewrite
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to rewrite text";
      setPromptError(errorMessage);
    } finally {
      setIsPromptLoading(false);
    }
  };

  // Generate candidate filename for display
  const getCandidateFileName = () => {
    if (!selectedFile || !selectedLanguage) return '';
    const originalName = selectedFile.name;
    const lastDotIndex = originalName.lastIndexOf('.');
    const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
    const extension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : '';
    return `${nameWithoutExt}_${selectedLanguage.code}${extension}`;
  };

  // Set up navigation actions when component mounts
  useEffect(() => {
    setRightActions(
      <Button
        className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
        onClick={handleReset}
        title="Clear translation"
      >
        <PlusIcon size={20} />
      </Button>
    );

    // Cleanup when component unmounts
    return () => {
      setRightActions(null);
    };
  }, [setRightActions, handleReset]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <main className="flex-1 flex flex-col overflow-hidden relative">
        
        {/* Text Translation Section */}
        <div className="w-full flex-grow overflow-hidden flex p-4 pt-20">
          <div className={`w-full h-full ${
            layoutMode === 'wide' 
              ? 'max-w-full mx-auto' 
              : 'max-w-[1200px] mx-auto'
          }`}>
            <div className="relative h-full w-full overflow-hidden">
              {/* Responsive layout: vertical stack on mobile/narrow screens, horizontal on wide screens */}
              <div className={`h-full flex flex-col md:flex-row min-h-0 ${isDragging ? 'p-2' : ''} transition-all duration-200`}>
                {/* Source section */}
                <div
                  ref={containerRef}
                  className={`flex-1 flex flex-col relative min-w-0 min-h-0 ${
                    isDragging 
                      ? 'border-2 border-dashed border-slate-400 dark:border-slate-500 bg-slate-50/80 dark:bg-slate-900/40 shadow-2xl shadow-slate-500/30 dark:shadow-slate-400/20 scale-[1.01] rounded-lg' 
                      : 'overflow-hidden'
                  } transition-all duration-200`}
                >
                  {/* File upload controls */}
                  <div className="absolute top-2 left-3 z-10">
                    {!selectedFile && supportedFiles.length > 0 && (
                      <Button
                        onClick={handleFileUploadClick}
                        className="inline-flex items-center gap-1 pl-0.5 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors"
                        title={`Select a file to translate (${supportedFiles.map(sf => sf.ext).join(', ')})`}
                      >
                        <UploadIcon size={14} />
                        <span>Upload file</span>
                      </Button>
                    )}
                    {!selectedFile && supportedFiles.length === 0 && (
                      <div className="h-8"></div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={supportedFiles.map(sf => sf.ext).join(',')}
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </div>
                  
                  {/* Drop zone overlay */}
                  {isDragging && supportedFiles.length > 0 && (
                    <div className="absolute inset-0 bg-gradient-to-r from-slate-500/20 via-slate-600/30 to-slate-500/20 dark:from-slate-400/20 dark:via-slate-500/30 dark:to-slate-400/20 rounded-lg flex flex-col items-center justify-center pointer-events-none z-20 backdrop-blur-sm">
                      <div className="text-slate-700 dark:text-slate-300 font-semibold text-lg text-center">
                        Drop files here
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 text-sm mt-1 text-center">
                        {supportedFiles.map(sf => sf.ext).join(', ')} files supported
                      </div>
                    </div>
                  )}
                  
                  {/* Show selected file in center */}
                  {selectedFile ? (
                    <div className="absolute inset-2 flex items-center justify-center">
                      <div className="bg-neutral-50/60 dark:bg-neutral-900/50 backdrop-blur-lg p-6 rounded-xl shadow-lg border border-neutral-200/60 dark:border-neutral-700/50 flex flex-col items-center gap-4 relative">
                        {/* Subtle delete button in top-right */}
                        <Button
                          onClick={handleFileClear}
                          className="absolute -top-2 -right-2 !p-1.5 !bg-neutral-50/70 dark:!bg-neutral-900/60 backdrop-blur-lg hover:!bg-neutral-50/80 dark:hover:!bg-neutral-900/70 rounded-full opacity-70 hover:opacity-100 transition-all border border-neutral-200/70 dark:border-neutral-700/60 shadow-sm"
                          title="Remove file"
                        >
                          <XIcon size={12} />
                        </Button>
                        
                        <FileIcon size={48} className="text-neutral-700 dark:text-neutral-300" />
                        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 text-center max-w-[200px] truncate">
                          {selectedFile.name}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <textarea
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder="Enter text to translate..."
                      className="absolute inset-0 w-full h-full pl-4 pr-2 pt-12 pb-2 bg-transparent border-none resize-none overflow-y-auto text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
                    />
                  )}
                </div>

                {/* Translate button */}
                <div className="relative flex items-center justify-center py-2 md:py-0 md:w-12 flex-shrink-0">
                  {/* Responsive divider: horizontal on mobile, vertical on desktop */}
                  <div className="absolute md:inset-y-0 md:w-px md:left-1/2 md:-translate-x-px inset-x-0 h-px md:h-auto bg-black/20 dark:bg-white/20"></div>
                  
                  <Button
                    onClick={() => performTranslate()}
                    className="!bg-neutral-50/60 dark:!bg-neutral-900/50 backdrop-blur-lg border border-neutral-200/60 dark:border-neutral-700/50 hover:!bg-neutral-50/70 dark:hover:!bg-neutral-900/60 !text-neutral-700 dark:!text-neutral-300 hover:!text-neutral-900 dark:hover:!text-neutral-100 z-10 relative px-2 py-2 rounded-lg shadow-lg transition-all"
                    title={selectedFile ? `Translate file to ${selectedLanguage?.name || 'Selected Language'}` : `Translate to ${selectedLanguage?.name || 'Selected Language'}`}
                    disabled={
                      isLoading || 
                      (selectedFile ? !selectedLanguage : !sourceText.trim())
                    }
                  >
                    {isLoading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <PilcrowRightIcon />
                    )}
                  </Button>
                </div>

                {/* Target section */}
                <div className="flex-1 flex flex-col relative min-w-0 min-h-0 overflow-hidden">
                  <div className="absolute top-2 left-3 z-10 flex items-center gap-2">
                    {/* Language selector */}
                    <Menu>
                      <MenuButton className="inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors">
                        <GlobeIcon size={14} />
                        <span>
                          {selectedLanguage?.name || 'Select Language'}
                        </span>
                      </MenuButton>
                      <MenuItems
                        transition
                        anchor="bottom start"
                        className="!max-h-[50vh] mt-2 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50"
                      >
                        {supportedLanguages.map((lang) => (
                          <MenuItem key={lang.code}>
                            <Button
                              onClick={() => setTargetLang(lang.code)}
                              className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors"
                            >
                              {lang.name}
                            </Button>
                          </MenuItem>
                        ))}
                      </MenuItems>
                    </Menu>

                    {/* Tone selector - only show for text translations, not file translations */}
                    {!selectedFile && (
                      <Menu>
                        <MenuButton className="inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors">
                          <ThermometerIcon size={14} />
                          <span>
                            {tone ? toneOptions.find(t => t.value === tone)?.label : 'Tone'}
                          </span>
                        </MenuButton>
                        <MenuItems
                          transition
                          anchor="bottom start"
                          className="mt-2 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50"
                        >
                          {toneOptions.map((toneOption) => (
                            <MenuItem key={toneOption.value}>
                              <Button
                                onClick={() => setTone(toneOption.value)}
                                className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors"
                              >
                                {toneOption.label}
                              </Button>
                            </MenuItem>
                          ))}
                        </MenuItems>
                      </Menu>
                    )}

                    {/* Style selector - only show for text translations, not file translations */}
                    {!selectedFile && (
                      <Menu>
                        <MenuButton className="inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors">
                          <SwatchBookIcon size={14} />
                          <span>
                            {style ? styleOptions.find(s => s.value === style)?.label : 'Style'}
                          </span>
                        </MenuButton>
                        <MenuItems
                          transition
                          anchor="bottom start"
                          className="mt-2 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50"
                        >
                          {styleOptions.map((styleOption) => (
                            <MenuItem key={styleOption.value}>
                              <Button
                                onClick={() => setStyle(styleOption.value)}
                                className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors"
                              >
                                {styleOption.label}
                              </Button>
                            </MenuItem>
                          ))}
                        </MenuItems>
                      </Menu>
                    )}
                  </div>
                  
                  {/* Interactive text area - back to original structure */}
                  <InteractiveText
                    text={currentText}
                    placeholder={selectedFile ? "" : "Translation will appear here..."}
                    className="absolute inset-0 w-full h-full pl-4 pr-2 pt-12 pb-2 bg-transparent overflow-y-auto text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
                    onTextSelect={handleTextSelect}
                    previewText={previewText}
                  />
                  
                  {/* Floating prompt input - positioned above the text with subtle design */}
                  {!selectedFile && translatedText && (
                    <div className="absolute bottom-4 left-4 right-4 z-20">
                      <form onSubmit={handlePromptSubmit}>
                        <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-neutral-700/40 shadow-lg shadow-black/5 dark:shadow-black/20 p-3">
                          <input
                            type="text"
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            placeholder="Refine translation..."
                            disabled={isPromptLoading}
                            className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none disabled:text-neutral-400"
                          />
                          <button
                            type="submit"
                            disabled={!promptText.trim() || isPromptLoading}
                            className="p-2 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 disabled:text-neutral-300 dark:disabled:text-neutral-600 rounded-xl hover:bg-white/40 dark:hover:bg-neutral-800/40 transition-all disabled:cursor-not-allowed"
                            title="Apply refinement"
                          >
                            {isPromptLoading ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <SparklesIcon size={16} />
                            )}
                          </button>
                        </div>
                        
                        {/* Error message - floating above input */}
                        {promptError && (
                          <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50/90 dark:bg-red-950/40 backdrop-blur-xl px-3 py-2 rounded-xl border border-red-200/40 dark:border-red-800/40">
                            {promptError}
                          </div>
                        )}
                      </form>
                    </div>
                  )}

                  {/* Subtle error notification for both text and file translations */}
                  {error && (
                    <div className="absolute bottom-2 left-2 right-2 z-10">
                      <div className="border border-red-200 dark:border-red-800 bg-red-50/95 dark:bg-red-950/20 backdrop-blur-lg rounded-lg overflow-hidden">
                        <button 
                          onClick={() => setErrorExpanded(!errorExpanded)}
                          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-red-100/50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                            <span className="text-xs font-medium text-red-600 dark:text-red-400">
                              {selectedFile ? 'File translation failed' : 'Translation failed'}
                            </span>
                            {!errorExpanded && (
                              <span className="text-xs text-red-500 dark:text-red-400 truncate">
                                Click to see details
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {errorExpanded ? 
                              <ChevronDown className="w-3 h-3 text-red-500" /> : 
                              <ChevronRight className="w-3 h-3 text-red-500" />
                            }
                          </div>
                        </button>
                        
                        {errorExpanded && (
                          <div className="px-3 pb-3 border-t border-red-200/50 dark:border-red-800/50">
                            <div className="mt-2 text-xs text-red-700 dark:text-red-300 break-words">
                              {error}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Show download link for translated files */}
                  {translatedFileUrl && translatedFileName && (
                    <div className="absolute inset-2 flex items-center justify-center">
                      <div 
                        className="bg-neutral-50/60 dark:bg-neutral-900/50 backdrop-blur-lg p-6 rounded-xl shadow-lg border border-neutral-200/60 dark:border-neutral-700/50 flex flex-col items-center gap-4 cursor-pointer hover:bg-neutral-50/70 dark:hover:bg-neutral-900/60 transition-all"
                        onClick={handleDownload} 
                        title="Download translated file"
                      >
                        <div className="relative">
                          <FileIcon size={48} className="text-neutral-700 dark:text-neutral-300" />
                          {/* Simple download icon in center */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <DownloadIcon size={16} className="text-neutral-800 dark:text-neutral-200" />
                          </div>
                        </div>
                        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 text-center max-w-[200px] truncate">
                          {translatedFileName}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Show loading state for file translation */}
                  {selectedFile && isLoading && (
                    <div className="absolute inset-2 flex items-center justify-center">
                      <div className="bg-neutral-50/60 dark:bg-neutral-900/50 backdrop-blur-lg p-6 rounded-xl shadow-lg border border-neutral-200/60 dark:border-neutral-700/50 flex flex-col items-center gap-4">
                        <Loader2 size={48} className="animate-spin text-neutral-700 dark:text-neutral-300" />
                        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 text-center">
                          Translating...
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Show candidate file when selected but not translated */}
                  {selectedFile && !isLoading && !translatedFileUrl && !translatedText && !error && (
                    <div className="absolute inset-2 flex items-center justify-center">
                      <div 
                        className="bg-neutral-50/40 dark:bg-neutral-900/30 backdrop-blur-lg border-2 border-dashed border-neutral-200/70 dark:border-neutral-700/60 p-6 rounded-xl flex flex-col items-center gap-4 cursor-pointer hover:bg-neutral-50/50 dark:hover:bg-neutral-900/40 transition-all"
                        onClick={() => performTranslate()} 
                        title="Click to translate file"
                      >
                        <div className="relative">
                          <FileIcon size={48} className="text-neutral-600 dark:text-neutral-400" />
                          {/* Simple translate icon in center */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <PilcrowRightIcon size={16} className="text-neutral-700 dark:text-neutral-300" />
                          </div>
                        </div>
                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 text-center max-w-[200px] truncate">
                          {getCandidateFileName()}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Show copy button for text translations and file translations that return text */}
                  {translatedText && (
                    <div className="absolute top-2 right-2 flex gap-1">
                      {enableTTS && <PlayButton text={currentText} className="h-4 w-4" />}
                      <CopyButton text={currentText} className="h-4 w-4" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Rewrite Menu */}
      {rewriteMenu && currentText && (
        <RewritePopover
          key={`${rewriteMenu.selectedText}-${rewriteMenu.selectionStart}-${rewriteMenu.selectionEnd}`}
          selectedText={rewriteMenu.selectedText}
          fullText={currentText}
          selectionStart={rewriteMenu.selectionStart}
          selectionEnd={rewriteMenu.selectionEnd}
          position={rewriteMenu.position}
          onClose={closeRewriteMenu}
          onSelect={handleSelect}
          onPreview={handlePreview}
        />
      )}
    </div>
  );
}

export default TranslatePage;
