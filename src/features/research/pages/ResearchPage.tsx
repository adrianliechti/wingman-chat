import { useState, useEffect, useCallback } from 'react';
import { PlusIcon, PanelLeftClose, PanelRightClose, PanelLeft, PanelRight, X } from 'lucide-react';
import { useNavigation } from '@/shell/hooks/useNavigation';
import { Markdown } from '@/shared/ui/Markdown';
import { CopyButton } from '@/shared/ui/CopyButton';
import { useResearch } from '../hooks/useResearch';
import { SourcesPanel } from '../components/SourcesPanel';
import { ResearchChat } from '../components/ResearchChat';
import { StudioPanel } from '../components/StudioPanel';
import { SlideViewer } from '../components/SlideViewer';
import { AudioViewer } from '../components/AudioViewer';
import * as store from '../lib/opfs-research';
import type { Research, ResearchOutput } from '../types/research';

export function ResearchPage() {
  const { setRightActions } = useNavigation();

  const [researchId, setResearchId] = useState<string | undefined>();
  const [researches, setResearches] = useState<Research[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [showStudio, setShowStudio] = useState(true);
  const [viewingOutput, setViewingOutput] = useState<ResearchOutput | null>(null);

  const {
    research,
    sources,
    outputs,
    messages,
    isSearching,
    isChatting,
    streamingContent,
    initResearch,
    addWebSource,
    addFileSource,
    deleteSource,
    sendMessage,
    generateOutput,
    deleteOutput,
  } = useResearch(researchId);

  // Load list of researches
  const loadResearches = useCallback(async () => {
    const list = await store.listResearches();
    setResearches(list);
    return list;
  }, []);

  // Create new research
  const handleNew = useCallback(async () => {
    const id = await initResearch();
    setResearchId(id);
    await loadResearches();
  }, [initResearch, loadResearches]);

  // Initial load + auto-create or select
  useEffect(() => {
    if (loaded) return;
    loadResearches().then((list) => {
      setLoaded(true);
      if (list.length === 0) {
        handleNew();
      } else {
        const sorted = [...list].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        setResearchId(sorted[0].id);
      }
    });
  }, [loaded, loadResearches, handleNew]);

  // Navigation actions
  useEffect(() => {
    setRightActions(
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
          onClick={() => setShowSources((v) => !v)}
          title={showSources ? 'Hide sources' : 'Show sources'}
        >
          {showSources ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
        <button
          type="button"
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
          onClick={() => setShowStudio((v) => !v)}
          title={showStudio ? 'Hide studio' : 'Show studio'}
        >
          {showStudio ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
        </button>
        <button
          type="button"
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
          onClick={handleNew}
          title="New notebook"
        >
          <PlusIcon size={20} />
        </button>
      </div>,
    );

    return () => {
      setRightActions(null);
    };
  }, [setRightActions, showSources, showStudio, handleNew]);

  const handleUploadClick = useCallback(() => {
    setShowSources(true);
  }, []);

  if (!research) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-neutral-400 animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      {/* Main 3-column layout */}
      <main className="w-full grow overflow-hidden flex pt-14 relative">
        {/* Left: Sources */}
        {showSources && (
          <div className="w-72 shrink-0 h-full overflow-hidden">
            <SourcesPanel
              sources={sources}
              isSearching={isSearching}
              onWebSearch={addWebSource}
              onFileAdd={addFileSource}
              onDeleteSource={deleteSource}
            />
          </div>
        )}

        {/* Center: Chat or Output Viewer */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {viewingOutput ? (
            <div className="h-full flex flex-col">
              {/* Output header */}
              <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between shrink-0">
                <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {viewingOutput.title}
                </h2>
                <div className="flex items-center gap-1">
                  {!viewingOutput.imageUrl && (
                    <CopyButton text={viewingOutput.content} />
                  )}
                  <button
                    type="button"
                    onClick={() => setViewingOutput(null)}
                    className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    title="Back to chat"
                  >
                    <X size={16} className="text-neutral-500" />
                  </button>
                </div>
              </div>

              {/* Output content */}
              <div className="flex-1 overflow-hidden min-h-0">
                {viewingOutput.audioUrl ? (
                  <AudioViewer
                    content={viewingOutput.content}
                    audioUrl={viewingOutput.audioUrl}
                  />
                ) : viewingOutput.slides && viewingOutput.slides.length > 0 ? (
                  <SlideViewer
                    content={viewingOutput.content}
                    slides={viewingOutput.slides}
                  />
                ) : viewingOutput.imageUrl ? (
                  <div className="h-full overflow-y-auto p-6">
                    <div className="flex flex-col items-center gap-4">
                      <img
                        src={viewingOutput.imageUrl}
                        alt={viewingOutput.title}
                        className="max-w-full rounded-lg shadow-md"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto p-6">
                    <div className="prose prose-neutral dark:prose-invert max-w-none">
                      <Markdown>{viewingOutput.content}</Markdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <ResearchChat
              messages={messages}
              sources={sources}
              isChatting={isChatting}
              streamingContent={streamingContent}
              onSend={sendMessage}
              onUploadClick={handleUploadClick}
            />
          )}
        </div>

        {/* Right: Studio */}
        {showStudio && (
          <div className="w-72 shrink-0 h-full overflow-hidden">
            <StudioPanel
              sources={sources}
              outputs={outputs}
              onGenerate={generateOutput}
              onDeleteOutput={deleteOutput}
              onSelectOutput={setViewingOutput}
            />
          </div>
        )}
      </main>
    </div>
  );
}
