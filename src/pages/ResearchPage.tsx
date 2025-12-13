import { useState, useEffect, useRef } from "react";
import { PlusIcon, Search, Loader2 } from "lucide-react";
import { useNavigation } from "../hooks/useNavigation";
import { useLayout } from "../hooks/useLayout";
import { CopyButton } from "../components/CopyButton";
import { Markdown } from "../components/Markdown";
import { getConfig } from "../config";

export function ResearchPage() {
  const { setRightActions } = useNavigation();
  const { layoutMode } = useLayout();
  const config = getConfig();
  
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleReset = () => {
    setInstruction("");
    setResult(null);
    setError(null);
    setIsLoading(false);
    textareaRef.current?.focus();
  };

  const handleResearch = async () => {
    if (!instruction.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const content = await config.client.research(instruction.trim());
      
      if (!content?.trim()) {
        setError("No research results could be found for the given instruction.");
      } else {
        setResult(content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleResearch();
    }
  };

  // Set up navigation actions
  useEffect(() => {
    setRightActions(
      <button
        type="button"
        className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
        onClick={handleReset}
        title="New research"
      >
        <PlusIcon size={20} />
      </button>
    );

    return () => {
      setRightActions(null);
    };
  }, [setRightActions]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <main className="w-full grow overflow-hidden flex pt-20 relative">
        <div className="w-full h-full flex">
          {/* 50/50 split layout */}
          <div className="flex-1 flex flex-col md:flex-row min-h-0 transition-all duration-200 gap-0">
            
            {/* Left: Input section */}
            <div className="flex-1 flex flex-col relative min-w-0 min-h-0 overflow-hidden">
              <textarea
                ref={textareaRef}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter your research instructions..."
                disabled={isLoading}
                className="absolute inset-0 w-full h-full pl-5 md:pl-6 pr-0 pt-4 pb-16 bg-transparent border-none resize-none overflow-y-auto text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none disabled:opacity-50"
              />

              {/* Research button at bottom */}
              <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + Enter to research
                </span>
                <button
                  type="button"
                  onClick={handleResearch}
                  disabled={!instruction.trim() || isLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-full text-sm font-medium transition-all hover:bg-neutral-900 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                >
                  <Search size={16} />
                  <span>Research</span>
                </button>
              </div>
            </div>

            {/* Vertical Divider */}
            <div className="relative flex items-center justify-center py-2 md:py-0 md:w-4 shrink-0">
              <div className="absolute md:inset-y-0 md:w-px md:left-1/2 md:-translate-x-px inset-x-0 h-px md:h-auto bg-black/20 dark:bg-white/20"></div>
            </div>

            {/* Right: Output section */}
            <div className="flex-1 relative min-w-0 min-h-0">
                
                {/* Loading Animation */}
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-6">
                      {/* Research Animation */}
                      <div className="relative w-24 h-24">
                        {/* Outer pulsing ring */}
                        <div className="absolute inset-0 rounded-full border-2 border-neutral-300 dark:border-neutral-600 animate-ping opacity-20" />
                        
                        {/* Middle rotating ring */}
                        <div className="absolute inset-2 rounded-full border-2 border-dashed border-neutral-400 dark:border-neutral-500 animate-spin" style={{ animationDuration: '3s' }} />
                        
                        {/* Inner spinning loader */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 size={32} className="text-neutral-600 dark:text-neutral-400 animate-spin" />
                        </div>
                        
                        {/* Orbiting dots */}
                        <div className="absolute inset-0 animate-spin" style={{ animationDuration: '2s' }}>
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-neutral-500 dark:bg-neutral-400 rounded-full" />
                        </div>
                        <div className="absolute inset-0 animate-spin" style={{ animationDuration: '2.5s', animationDirection: 'reverse' }}>
                          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-500 rounded-full" />
                        </div>
                      </div>
                      
                      <div className="text-center">
                        <p className="text-neutral-600 dark:text-neutral-400 font-medium">
                          Researching...
                        </p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-500 mt-1">
                          Gathering information from the web
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Error State */}
                {error && !isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <div className="max-w-md p-6 bg-red-50/50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/50 rounded-xl">
                      <p className="text-red-600 dark:text-red-400 text-center">
                        {error}
                      </p>
                    </div>
                  </div>
                )}

                {/* Result Section */}
                {result && !isLoading && (
                  <>
                    {/* Copy button - fixed position */}
                    <div className="absolute top-2 right-2 z-10">
                      <CopyButton text={result} />
                    </div>
                    
                    {/* Scrollable markdown content */}
                    <div className="absolute inset-0 overflow-y-auto">
                      <div className={`min-h-full px-4 md:px-6 pt-2 pb-4 ${layoutMode === "wide" ? "" : "max-w-5xl mx-auto w-full"}`}>
                        <div className="-mr-2 md:-mr-3 pr-4 md:pr-6 pl-5 md:pl-6 prose prose-neutral dark:prose-invert max-w-none">
                          <Markdown>{result}</Markdown>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Empty State */}
                {!result && !isLoading && !error && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                      <Search size={28} className="text-neutral-400 dark:text-neutral-500" />
                    </div>
                    <p className="text-neutral-500 dark:text-neutral-400">
                      Enter a research topic
                    </p>
                    <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">
                      Results will appear here
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
