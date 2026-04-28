import { Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { PlusIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/shared/ui/Markdown";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";
import { AudioViewer } from "../components/AudioViewer";
import { MindMapViewer } from "../components/MindMapViewer";
import { NotebookChat } from "../components/NotebookChat";
import { NotebookSidebar } from "../components/NotebookSidebar";
import { QuizViewer } from "../components/QuizViewer";
import { ReportViewer } from "../components/ReportViewer";
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

  // Read the optional :notebookId from the child route. The parent component never
  // remounts when navigating between /notebook and /notebook/:id because the child
  // route is nested under this parent route in the router tree.
  const notebookIdMatch = useMatch({ from: "/app/notebook/$notebookId", shouldThrow: false });
  const notebookId = notebookIdMatch?.params.notebookId;

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewingOutputId, setViewingOutputId] = useState<string | null>(null);

  const [showSourcesDrawer, setShowSourcesDrawer] = useState(false);
  const [showStudioDrawer, setShowStudioDrawer] = useState(false);

  const {
    notebook,
    loading,
    sources,
    outputs,
    messages,
    isSearching,
    isChatting,
    streamingContent,
    searchWeb,
    addSearchResult,
    scrapeWeb,
    addScrapeResult,
    addFileSource,
    addTextSource,
    deleteSource,
    sendMessage,
    generateOutput,
    updateOutput,
    deleteOutput,
  } = useNotebook(notebookId);

  // Derive viewingOutput from outputs array so it stays in sync during generation
  // and after refinements (updateOutput writes back into outputs).
  const viewingOutput = viewingOutputId ? (outputs.find((o) => o.id === viewingOutputId) ?? null) : null;
  const setViewingOutput = useCallback((o: NotebookOutput | null) => {
    setViewingOutputId(o?.id ?? null);
  }, []);

  // Load notebook list
  const loadNotebooks = useCallback(async () => {
    const list = await store.listNotebooks();
    setNotebooks(list);
    return list;
  }, []);

  // Redirect to the most recently updated notebook.
  const goToLatest = useCallback(
    async (replace = false) => {
      const list = await loadNotebooks();
      if (list.length > 0) {
        const sorted = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        navigate({ to: "/notebook/$notebookId", params: { notebookId: sorted[0].id }, replace });
      }
    },
    [loadNotebooks, navigate],
  );

  // Track the previous notebookId to detect nav-link re-entry vs intentional new.
  const prevNotebookIdRef = useRef(notebookId);
  // Set to true when + is clicked so the effect knows NOT to redirect.
  const isNewRequestedRef = useRef(false);

  // Handles three cases when notebookId changes:
  //  1. + clicked (isNewRequested=true): stay on empty state — no redirect.
  //  2. Nav link clicked while already loaded (prevId=real id → undefined): go to latest.
  //  3. Notebook lazily created from empty state (prevId=undefined, notebook.id just appeared): update URL.
  useEffect(() => {
    const prevId = prevNotebookIdRef.current;
    prevNotebookIdRef.current = notebookId;

    if (!notebookId) {
      if (isNewRequestedRef.current) {
        // + was clicked — stay on empty state
        isNewRequestedRef.current = false;
        return;
      }
      // Notebook was lazily created (first source added) — push its id into the URL
      if (notebook?.id && prevId === undefined) {
        navigate({ to: "/notebook/$notebookId", params: { notebookId: notebook.id }, replace: true });
        loadNotebooks();
        return;
      }
      if (prevId !== undefined && loaded) {
        // Nav link clicked while on page — go to latest
        goToLatest();
      }
      return;
    }
  }, [notebook?.id, notebookId, navigate, loadNotebooks, loaded, goToLatest]);

  // Navigate to empty state — component stays mounted, only the child outlet changes.
  const handleNew = useCallback(() => {
    setViewingOutput(null);
    isNewRequestedRef.current = true;
    navigate({ to: "/notebook" });
  }, [navigate, setViewingOutput]);

  // Delete notebook
  const handleDelete = useCallback(
    async (id: string) => {
      await store.deleteNotebook(id);
      const list = await loadNotebooks();

      if (id === notebookId) {
        setViewingOutput(null);
        if (list.length > 0) {
          const sorted = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          navigate({ to: "/notebook/$notebookId", params: { notebookId: sorted[0].id } });
        } else {
          navigate({ to: "/notebook" });
        }
      }
    },
    [notebookId, loadNotebooks, navigate, setViewingOutput],
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
        setViewingOutput(null);
        navigate({ to: "/notebook/$notebookId", params: { notebookId: id } });
      }
    },
    [notebookId, navigate, setViewingOutput],
  );

  // Initial load: auto-select the most recent notebook if none is in the URL.
  useEffect(() => {
    if (loaded) return;
    loadNotebooks().then((list) => {
      setLoaded(true);
      if (notebookId) return;
      if (list.length > 0) {
        const sorted = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        navigate({ to: "/notebook/$notebookId", params: { notebookId: sorted[0].id }, replace: true });
      }
    });
  }, [loaded, loadNotebooks, notebookId, navigate]);

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

  const handleSelectOutput = useCallback(
    (output: NotebookOutput) => {
      setViewingOutput(output);
      setShowStudioDrawer(false);
    },
    [setViewingOutput],
  );

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      {/* Render the child route (provides :notebookId param, renders nothing visible) */}
      <Outlet />
      {/* Main layout */}
      <main className="w-full grow overflow-hidden flex pt-14 relative">
        {/* ── Desktop: Left Sources panel ── */}
        <div className="hidden md:block w-72 shrink-0 h-full overflow-hidden">
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

        {/* Desktop divider */}
        <div className="hidden md:flex relative shrink-0 w-4 items-center justify-center">
          <div className="absolute inset-y-4 w-px left-1/2 -translate-x-px bg-black/10 dark:bg-white/10" />
        </div>

        {/* Center: Chat or Output Viewer */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {loading ? (
            <div className="h-full" />
          ) : viewingOutput ? (
            <div className="h-full flex flex-col relative">
              {/* Output buttons */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                {!viewingOutput.imageUrl && !viewingOutput.audioUrl && viewingOutput.type !== "report" && (
                  <CopyButton text={viewingOutput.content} />
                )}
                <button
                  type="button"
                  onClick={() => setViewingOutputId(null)}
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
                ) : viewingOutput.type === "slides" ? (
                  <SlideViewer output={viewingOutput} onRefine={updateOutput} />
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
                ) : viewingOutput.type === "report" ? (
                  <ReportViewer content={viewingOutput.content} />
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
              showSourcesActive={showSourcesDrawer}
              showStudioActive={showStudioDrawer}
              isSearching={isSearching}
              outputCount={outputs.filter((o) => o.status === "completed").length}
              isGeneratingOutput={outputs.some((o) => o.status === "generating")}
              onShowSources={() => {
                setShowStudioDrawer(false);
                setShowSourcesDrawer((v) => !v);
              }}
              onShowStudio={() => {
                setShowSourcesDrawer(false);
                setShowStudioDrawer((v) => !v);
              }}
            />
          )}
        </div>

        {/* Desktop divider */}
        <div className="hidden md:flex relative shrink-0 w-4 items-center justify-center">
          <div className="absolute inset-y-4 w-px left-1/2 -translate-x-px bg-black/10 dark:bg-white/10" />
        </div>

        {/* ── Desktop: Right Studio panel ── */}
        <div className="hidden md:block w-72 shrink-0 h-full overflow-hidden">
          {loading ? (
            <div className="h-full" />
          ) : (
            <StudioPanel
              sources={sources}
              outputs={outputs}
              onGenerate={generateOutput}
              onDeleteOutput={deleteOutput}
              onSelectOutput={handleSelectOutput}
            />
          )}
        </div>

        {/* ── Mobile: backdrop ── */}
        <button
          type="button"
          aria-label="Close panel"
          className={`md:hidden absolute inset-0 z-20 bg-black/40 transition-opacity duration-300 cursor-default ${
            showSourcesDrawer || showStudioDrawer ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
          onClick={() => {
            setShowSourcesDrawer(false);
            setShowStudioDrawer(false);
          }}
        />

        {/* ── Mobile: Sources bottom sheet ── */}
        <div
          className={`md:hidden absolute inset-x-0 bottom-0 z-30 h-[75vh] rounded-t-2xl bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden flex flex-col transition-transform duration-300 ease-in-out ${
            showSourcesDrawer ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700" />
          </div>
          {!loading && (
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

        {/* ── Mobile: Studio bottom sheet ── */}
        <div
          className={`md:hidden absolute inset-x-0 bottom-0 z-30 h-[75vh] rounded-t-2xl bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden flex flex-col transition-transform duration-300 ease-in-out ${
            showStudioDrawer ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700" />
          </div>
          {!loading && (
            <StudioPanel
              sources={sources}
              outputs={outputs}
              onGenerate={generateOutput}
              onDeleteOutput={deleteOutput}
              onSelectOutput={handleSelectOutput}
            />
          )}
        </div>
      </main>
    </div>
  );
}
