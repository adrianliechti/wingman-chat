import { useMatch, useNavigate } from "@tanstack/react-router";
import { PlusIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/shared/ui/Markdown";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";
import { AudioViewer } from "../components/AudioViewer";
import { MindMapViewer } from "../components/MindMapViewer";
import { NotebookChat } from "../components/NotebookChat";
import { NotebookSidebar } from "../components/NotebookSidebar";
import { QuizViewer } from "../components/QuizViewer";
import { SlideViewer } from "../components/SlideViewer";
import { SourcesPanel } from "../components/SourcesPanel";
import { StudioPanel } from "../components/StudioPanel";
import { useNotebook } from "../hooks/useNotebook";
import * as store from "../lib/opfs-notebook";
import type { Notebook, NotebookOutput } from "../types/notebook";

export function NotebookPage() {
  const { setRightActions } = useNavigation();
  const { setSidebarContent } = useSidebar();
  const navigate = useNavigate();

  const notebookIdMatch = useMatch({ from: "/app/notebook/$notebookId", shouldThrow: false });
  const routeNotebookId = notebookIdMatch?.params.notebookId;

  const [notebookId, setNotebookId] = useState<string | undefined>();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewingOutput, setViewingOutput] = useState<NotebookOutput | null>(null);

  const {
    notebook,
    loading,
    sources,
    outputs,
    messages,
    isSearching,
    isChatting,
    streamingContent,
    initNotebook,
    searchWeb,
    addSearchResult,
    scrapeWeb,
    addScrapeResult,
    addFileSource,
    addTextSource,
    deleteSource,
    sendMessage,
    generateOutput,
    deleteOutput,
  } = useNotebook(notebookId);

  // Load notebook list
  const loadNotebooks = useCallback(async () => {
    const list = await store.listNotebooks();
    setNotebooks(list);
    return list;
  }, []);

  // Sync URL → state for deep links and browser back/forward
  useEffect(() => {
    if (routeNotebookId && routeNotebookId !== notebookId) {
      setNotebookId(routeNotebookId);
      setViewingOutput(null);
    }
  }, [routeNotebookId, notebookId]);

  // Create new notebook (only if current one has content, or none exists)
  const handleNew = useCallback(async () => {
    // Don't create if the current notebook is already empty
    if (notebook && sources.length === 0 && messages.length === 0 && outputs.length === 0) {
      return;
    }
    const id = await initNotebook();
    setNotebookId(id);
    setViewingOutput(null);
    navigate({ to: "/notebook/$notebookId", params: { notebookId: id } });
    await loadNotebooks();
  }, [initNotebook, loadNotebooks, navigate, notebook, sources, messages, outputs]);

  // Delete notebook
  const handleDelete = useCallback(
    async (id: string) => {
      await store.deleteNotebook(id);
      const list = await loadNotebooks();

      if (id === notebookId) {
        // Select next available, or leave empty
        if (list.length > 0) {
          const sorted = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          setNotebookId(sorted[0].id);
          navigate({ to: "/notebook/$notebookId", params: { notebookId: sorted[0].id } });
        } else {
          // Truly no notebooks left — create one
          const newId = await initNotebook();
          setNotebookId(newId);
          navigate({ to: "/notebook/$notebookId", params: { notebookId: newId } });
          await loadNotebooks();
        }
        setViewingOutput(null);
      }
    },
    [notebookId, loadNotebooks, initNotebook, navigate],
  );

  // Rename notebook
  const handleRename = useCallback(async (id: string, customTitle: string | undefined) => {
    const nb = await store.getNotebook(id);
    if (!nb) return;
    const updated = { ...nb, customTitle, updatedAt: new Date().toISOString() };
    await store.saveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => (n.id === id ? { ...n, customTitle, updatedAt: updated.updatedAt } : n)));
  }, []);

  // Select notebook
  const handleSelect = useCallback(
    (id: string) => {
      if (id !== notebookId) {
        setNotebookId(id);
        setViewingOutput(null);
        navigate({ to: "/notebook/$notebookId", params: { notebookId: id } });
      }
    },
    [notebookId, navigate],
  );

  // Initial load + auto-create or select
  useEffect(() => {
    if (loaded) return;
    loadNotebooks().then((list) => {
      setLoaded(true);

      // If URL already has a notebook ID, use it
      if (routeNotebookId) {
        setNotebookId(routeNotebookId);
        return;
      }

      if (list.length === 0) {
        handleNew();
      } else {
        const sorted = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setNotebookId(sorted[0].id);
        navigate({ to: "/notebook/$notebookId", params: { notebookId: sorted[0].id }, replace: true });
      }
    });
  }, [loaded, loadNotebooks, handleNew, routeNotebookId, navigate]);

  // Sidebar content
  const sidebarContent = useMemo(() => {
    if (notebooks.length === 0 && !loaded) return null;
    return (
      <NotebookSidebar
        notebooks={notebooks}
        activeId={notebookId}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onRename={handleRename}
        onNew={handleNew}
      />
    );
  }, [notebooks, notebookId, handleSelect, handleDelete, handleRename, handleNew, loaded]);

  useEffect(() => {
    setSidebarContent(sidebarContent);
    return () => setSidebarContent(null);
  }, [sidebarContent, setSidebarContent]);

  // Navigation actions
  useEffect(() => {
    setRightActions(
      <div className="flex items-center gap-1">
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
  }, [setRightActions, handleNew]);

  if (!notebook && !loading) {
    return <div className="h-full w-full" />;
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      {/* Main 3-column layout */}
      <main className="w-full grow overflow-hidden flex pt-14 relative">
        {/* Left: Sources */}
        <div className="w-72 shrink-0 h-full overflow-hidden">
          {loading ? (
            <div className="h-full" />
          ) : (
            <SourcesPanel
              sources={sources}
              isSearching={isSearching}
              searchWeb={searchWeb}
              addSearchResult={addSearchResult}
              scrapeWeb={scrapeWeb}
              addScrapeResult={addScrapeResult}
              onFileAdd={addFileSource}
              onTextAdd={addTextSource}
              onDeleteSource={deleteSource}
            />
          )}
        </div>

        {/* Divider */}
        <div className="relative shrink-0 w-4 flex items-center justify-center">
          <div className="absolute inset-y-4 w-px left-1/2 -translate-x-px bg-black/10 dark:bg-white/10"></div>
        </div>

        {/* Center: Chat or Output Viewer */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {loading ? (
            <div className="h-full" />
          ) : viewingOutput ? (
            <div className="h-full flex flex-col relative">
              {/* Output buttons */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                {!viewingOutput.imageUrl && !viewingOutput.audioUrl && <CopyButton text={viewingOutput.content} />}
                <button
                  type="button"
                  onClick={() => setViewingOutput(null)}
                  className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  title="Back to chat"
                >
                  <X size={16} className="text-neutral-500" />
                </button>
              </div>

              {/* Output content */}
              <div className="flex-1 overflow-hidden min-h-0 pt-8 pb-4">
                {viewingOutput.quiz && viewingOutput.quiz.length > 0 ? (
                  <QuizViewer questions={viewingOutput.quiz} />
                ) : viewingOutput.mindMap ? (
                  <MindMapViewer root={viewingOutput.mindMap} />
                ) : viewingOutput.audioUrl ? (
                  <AudioViewer content={viewingOutput.content} audioUrl={viewingOutput.audioUrl} />
                ) : viewingOutput.slides && viewingOutput.slides.length > 0 ? (
                  <SlideViewer content={viewingOutput.content} slides={viewingOutput.slides} />
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
            <NotebookChat
              messages={messages}
              sources={sources}
              isChatting={isChatting}
              streamingContent={streamingContent}
              onSend={sendMessage}
            />
          )}
        </div>

        {/* Divider */}
        <div className="relative shrink-0 w-4 flex items-center justify-center">
          <div className="absolute inset-y-4 w-px left-1/2 -translate-x-px bg-black/10 dark:bg-white/10"></div>
        </div>

        {/* Right: Studio */}
        <div className="w-72 shrink-0 h-full overflow-hidden">
          {loading ? (
            <div className="h-full" />
          ) : (
            <StudioPanel
              sources={sources}
              outputs={outputs}
              onGenerate={generateOutput}
              onDeleteOutput={deleteOutput}
              onSelectOutput={setViewingOutput}
            />
          )}
        </div>
      </main>
    </div>
  );
}
