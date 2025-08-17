import { useEffect, useRef, useState, useCallback } from "react";
import { useDropZone } from "../hooks/useDropZone";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { PilcrowRightIcon, Loader2, PlusIcon, GlobeIcon, FileIcon, UploadIcon, XIcon, DownloadIcon, ThermometerIcon, SwatchBookIcon } from "lucide-react";
import { useNavigation } from "../hooks/useNavigation";
import { useLayout } from "../hooks/useLayout";
import { useTranslate } from "../hooks/useTranslate";
import { CopyButton } from "../components/CopyButton";
import { PlayButton } from "../components/PlayButton";
import { RewritePopover } from "../components/RewritePopover";
import { InteractiveText } from "../components/InteractiveText";
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
  
  const config = getConfig();
  const enableTTS = config.tts;
  
  // Use translate context
  const {
    sourceText,
    translatedText,
    tone,
    style,
    isLoading,
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
      const link = document.createElement('a');
      link.href = translatedFileUrl;
      link.download = translatedFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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

  const handleAlternativeSelect = (alternative: string, contextToReplace: string) => {
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
  };

  const handlePreview = (previewText: string | null) => {
    setPreviewText(previewText);
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
                  <div className="absolute top-2 left-4 z-10">
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
                      className="absolute inset-0 w-full h-full pl-4 pr-8 md:pr-2 pt-12 pb-2 md:pb-2 bg-transparent border-none resize-none overflow-y-auto text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
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
                            {toneOptions.find(t => t.value === tone)?.label || 'Default'}
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
                            {styleOptions.find(s => s.value === style)?.label || 'Default'}
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
                  <InteractiveText
                    text={currentText}
                    placeholder={selectedFile ? "" : "Translation will appear here..."}
                    className="absolute inset-0 w-full h-full pl-4 pr-2 pt-16 pb-2 bg-transparent overflow-y-auto text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
                    onTextSelect={handleTextSelect}
                    previewText={previewText}
                  />
                  
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
                  {selectedFile && !isLoading && !translatedFileUrl && !translatedText && (
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
          onAlternativeSelect={handleAlternativeSelect}
          onPreview={handlePreview}
        />
      )}
    </div>
  );
}

export default TranslatePage;
