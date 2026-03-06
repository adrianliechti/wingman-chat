import { useState, useEffect, useRef } from "react";
import { PlusIcon, Search, Loader2, ArrowRight } from "lucide-react";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useLayout } from "@/shell/hooks/useLayout";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/shared/ui/Markdown";
import { getConfig } from "@/shared/config";

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
      const content = await config.client.research(config.researcher?.model || "", instruction.trim());

      if (!content?.trim()) {
        setError(
          "No research results could be found for the given instruction.",
        );
      } else {
        setResult(content);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Research failed. Please try again.",
      );
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
      </button>,
    );

    return () => {
      setRightActions(null);
    };
  }, [setRightActions]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <main className="w-full grow overflow-hidden flex p-4 pt-20 relative">
        <div
          className={`w-full h-full ${layoutMode === "wide"
              ? "max-w-full mx-auto"
              : "max-w-[1200px] mx-auto"
            }`}
        >
          <div className="relative h-full w-full overflow-hidden">
            {/* 50/50 split layout */}
            <div className="h-full flex flex-col md:flex-row min-h-0 transition-all duration-200">
              {/* Left: Input section */}
              <div className="flex-1 flex flex-col relative min-w-0 min-h-0 overflow-hidden">
                <textarea
                  ref={textareaRef}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter your research instructions..."
                  disabled={isLoading}
                  className="absolute inset-0 w-full h-full pl-4 pr-2 pt-12 pb-4 bg-transparent border-none resize-none overflow-y-auto text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none disabled:opacity-50"
                />
              </div>

              {/* Divider with Research Button */}
              <div className="relative flex items-center justify-center py-2 md:py-0 md:w-14 shrink-0">
                <div className="absolute md:inset-y-0 md:w-px md:left-1/2 md:-translate-x-px inset-x-0 h-px md:h-auto bg-black/20 dark:bg-white/20"></div>

                {/* Research button centered on divider - only show when input available and not loading */}
                {instruction.trim() && !isLoading && (
                  <button
                    type="button"
                    onClick={handleResearch}
                    className="relative z-20 size-11 rounded-full bg-white dark:bg-neutral-950 border border-black/20 dark:border-white/20 text-neutral-500 dark:text-neutral-400 transition-all duration-200 hover:border-black/40 dark:hover:border-white/40 hover:text-neutral-700 dark:hover:text-neutral-200 hover:scale-105 active:scale-95 flex items-center justify-center"
                    title={`Research (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter)`}
                  >
                    <ArrowRight size={18} className="rotate-90 md:rotate-0" />
                  </button>
                )}
              </div>

              {/* Right: Output section */}
              <div className="flex-1 flex flex-col relative min-w-0 min-h-0 overflow-hidden">
                {/* Loading Animation */}
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-6">
                      {/* Research Animation */}
                      <div className="relative w-24 h-24">
                        {/* Outer pulsing ring */}
                        <div className="absolute inset-0 rounded-full border-2 border-neutral-300 dark:border-neutral-600 animate-ping opacity-20" />

                        {/* Middle rotating ring */}
                        <div
                          className="absolute inset-2 rounded-full border-2 border-dashed border-neutral-400 dark:border-neutral-500 animate-spin"
                          style={{ animationDuration: "3s" }}
                        />

                        {/* Inner spinning loader */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2
                            size={32}
                            className="text-neutral-600 dark:text-neutral-400 animate-spin"
                          />
                        </div>

                        {/* Orbiting dots */}
                        <div
                          className="absolute inset-0 animate-spin"
                          style={{ animationDuration: "2s" }}
                        >
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-neutral-500 dark:bg-neutral-400 rounded-full" />
                        </div>
                        <div
                          className="absolute inset-0 animate-spin"
                          style={{
                            animationDuration: "2.5s",
                            animationDirection: "reverse",
                          }}
                        >
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
                      <div
                        className={`min-h-full pl-4 pr-2 pt-12 pb-4 ${layoutMode === "wide" ? "" : "max-w-5xl mx-auto w-full"}`}
                      >
                        <div className="prose prose-neutral dark:prose-invert max-w-none">
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
                        <Search
                          size={28}
                          className="text-neutral-400 dark:text-neutral-500"
                        />
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
        </div>
      </main>
    </div>
  );
}
