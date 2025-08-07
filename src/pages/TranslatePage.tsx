import { useEffect, useRef } from "react";
import { useDropZone } from "../hooks/useDropZone";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { PilcrowRightIcon, Loader2, PlusIcon, GlobeIcon, FileIcon, UploadIcon, XIcon, DownloadIcon } from "lucide-react";
import { useNavigation } from "../hooks/useNavigation";
import { useLayout } from "../hooks/useLayout";
import { useTranslate } from "../hooks/useTranslate";
import { CopyButton } from "../components/CopyButton";
import { PlayButton } from "../components/PlayButton";
import { Markdown } from "../components/Markdown";
import { getConfig } from "../config";

export function TranslatePage() {
  const { setRightActions } = useNavigation();
  const { layoutMode } = useLayout();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const config = getConfig();
  const enableTTS = config.tts;
  
  // Use translate context
  const {
    sourceText,
    translatedText,
    teachingContent,
    isLoading,
    isLoadingTeaching,
    supportedLanguages,
    selectedLanguage,
    selectedFile,
    translatedFileUrl,
    translatedFileName,
    supportedFiles,
    setSourceText,
    setTargetLang,
    performTranslate,
    handleReset,
    selectFile,
    clearFile
  } = useTranslate();

  const handleTranslateButtonClick = () => {
    performTranslate();
  };

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
        <div className="w-full flex-grow overflow-auto flex p-4 pt-20">
          <div className={`w-full h-full ${
            layoutMode === 'wide' 
              ? 'max-w-full mx-auto' 
              : 'max-w-[1200px] mx-auto'
          }`}>
            <div className="relative w-full">
              {/* Responsive layout: vertical stack on mobile/narrow screens, horizontal on wide screens */}
              <div className={`min-h-[500px] flex flex-col md:flex-row ${isDragging ? 'p-2' : ''} transition-all duration-200`}>
                {/* Source section */}
                <div
                  ref={containerRef}
                  className={`flex-1 flex flex-col relative min-w-0 h-[500px] ${
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
                    onClick={handleTranslateButtonClick}
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
                <div className="flex-1 flex flex-col relative min-w-0 h-[500px] overflow-hidden">
                  <div className="absolute top-2 left-3 z-10">
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
                  </div>
                  <textarea
                    value={translatedText}
                    readOnly
                    placeholder={selectedFile ? "" : "Translation will appear here..."}
                    className="absolute inset-0 w-full h-full pl-4 pr-2 pt-12 pb-2 bg-transparent border-none resize-none overflow-y-auto text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
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
                        onClick={handleTranslateButtonClick} 
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
                      {enableTTS && <PlayButton text={translatedText} className="h-4 w-4" />}
                      <CopyButton text={translatedText} className="h-4 w-4" />
                    </div>
                  )}
                </div>
              </div>

              {/* Language Teaching Section */}
              {(teachingContent || isLoadingTeaching) && (
                <div className="mt-6 p-6 bg-gradient-to-br from-neutral-50/80 via-neutral-50/60 to-neutral-100/80 dark:from-neutral-900/60 dark:via-neutral-900/40 dark:to-neutral-800/60 backdrop-blur-lg border border-neutral-200/60 dark:border-neutral-700/50 rounded-xl shadow-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg shadow-sm">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">
                        Language Learning Guide
                      </h3>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        Interactive vocabulary analysis for {selectedLanguage?.name || 'your target language'}
                      </p>
                    </div>
                    {isLoadingTeaching && (
                      <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Analyzing...</span>
                      </div>
                    )}
                  </div>
                  
                  {teachingContent ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <div className="bg-white/60 dark:bg-neutral-800/40 rounded-lg p-4 border border-neutral-200/40 dark:border-neutral-700/40">
                        <Markdown>{teachingContent}</Markdown>
                      </div>
                    </div>
                  ) : isLoadingTeaching ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="text-center">
                        <div className="inline-flex items-center gap-3 px-4 py-3 bg-white/60 dark:bg-neutral-800/40 rounded-lg border border-neutral-200/40 dark:border-neutral-700/40">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse delay-75"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse delay-150"></div>
                          <span className="text-sm text-neutral-600 dark:text-neutral-400 ml-2">
                            Generating personalized learning content...
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default TranslatePage;
