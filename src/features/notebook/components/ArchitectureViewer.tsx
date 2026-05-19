import { Controls, type EdgeTypes, type NodeTypes, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { refineArchitecture } from "../lib/architecture-refine";
import type { ArchitectureView, NotebookOutput } from "../types/notebook";
import { ArchitectureGroupNode } from "./architecture/ArchitectureGroupNode";
import { ArchitectureRelationEdge } from "./architecture/ArchitectureRelationEdge";
import { ArchitectureShapeNode } from "./architecture/ArchitectureShapeNode";
import { SequenceCanvas } from "./architecture/SequenceCanvas";
import { buildArchitectureFlow, isSequenceDiagram } from "./architecture/graphLayout";

interface ArchitectureViewerProps {
  output: NotebookOutput;
  onRefine?: (updatedOutput: NotebookOutput) => void;
}

interface ViewTab {
  view: ArchitectureView;
  label: string;
  count: number;
}

const nodeTypes: NodeTypes = {
  architectureShape: ArchitectureShapeNode,
  architectureGroup: ArchitectureGroupNode,
};
const edgeTypes: EdgeTypes = {
  architectureRelation: ArchitectureRelationEdge,
};
const proOptions = { hideAttribution: true };

const VIEW_PLACEHOLDER: Record<ArchitectureView, string> = {
  "c4-context": "Refine… e.g. add the regulator reporting feed as an external system",
  "c4-container": "Refine… e.g. add a Redis cache between API and core banking",
  "c4-component": "Refine… e.g. extract validation into a dedicated component",
  deployment: "Refine… e.g. add a DR region in eu-west-1 with async replication",
};

function ArchitectureInner({ output, onRefine }: ArchitectureViewerProps) {
  const diagram = output.architecture;

  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  // Active C4 view (one of four tabs). Resets when switching outputs.
  const [viewKind, setViewKind] = useState<ArchitectureView>("c4-container");
  const [prevOutputId, setPrevOutputId] = useState(output.id);
  if (prevOutputId !== output.id) {
    setPrevOutputId(output.id);
    setViewKind("c4-container");
  }

  // Per-view element counts, used both for tab labels and to bias the
  // default active tab toward whichever view has the most elements.
  const counts = useMemo(() => {
    const c: Record<ArchitectureView, number> = { "c4-context": 0, "c4-container": 0, "c4-component": 0, deployment: 0 };
    if (!diagram) return c;
    for (const e of diagram.elements) {
      for (const v of e.views ?? []) c[v] = (c[v] ?? 0) + 1;
    }
    return c;
  }, [diagram]);

  const flow = useMemo(
    () => (diagram && !isSequenceDiagram(diagram) ? buildArchitectureFlow(diagram, viewKind) : null),
    [diagram, viewKind],
  );

  const handleRefineSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!refinePrompt.trim() || isRefining || !diagram) return;
    setIsRefining(true);
    setRefineError(null);
    try {
      const updated = await refineArchitecture(output, refinePrompt.trim());
      if (updated !== output) onRefine?.(updated);
      setRefinePrompt("");
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  };

  if (!diagram) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-neutral-400">
        No architecture diagram
      </div>
    );
  }

  const isSeq = isSequenceDiagram(diagram);
  const tabs: ViewTab[] = [
    { view: "c4-context", label: "Context", count: counts["c4-context"] },
    { view: "c4-container", label: "Container", count: counts["c4-container"] },
    { view: "c4-component", label: "Component", count: counts["c4-component"] },
    { view: "deployment", label: "Deployment", count: counts.deployment },
  ];

  return (
    <div className="h-full w-full flex flex-col">
      {/* Tabs only — title/summary live in the StudioPanel row and the page
          preview chrome already shows the Download/X icons. */}
      {!isSeq && (
        <header className="shrink-0 flex items-center gap-3 px-3 py-2" role="tablist">
          {tabs.map((tab) => {
            const active = tab.view === viewKind;
            const empty = tab.count === 0;
            return (
              <button
                key={tab.view}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setViewKind(tab.view)}
                className={`py-0.5 text-[11px] transition-colors border-b ${
                  active
                    ? "border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100 font-semibold"
                    : empty
                      ? "border-transparent text-neutral-400 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400"
                      : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                }`}
                title={empty ? `No ${tab.label.toLowerCase()} yet — refine to add` : `Switch to ${tab.label}`}
              >
                {tab.label}
              </button>
            );
          })}
        </header>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 relative">
        {isSeq ? (
          <div className="h-full w-full overflow-auto">
            <SequenceCanvas diagram={diagram} />
          </div>
        ) : flow ? (
          <ReactFlow
            key={viewKind /* force fitView on tab switch */}
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            proOptions={proOptions}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.2}
            maxZoom={2}
          >
            {/* Lift controls above the floating refine input. */}
            <Controls showInteractive={false} position="bottom-left" style={{ bottom: 80 }} />
          </ReactFlow>
        ) : null}

        {/* Refine */}
        <div className="absolute bottom-4 left-3 right-3 z-20">
          <form onSubmit={handleRefineSubmit}>
            <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-neutral-700/40 shadow-lg shadow-black/5 dark:shadow-black/20 p-3">
              <input
                type="text"
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                placeholder={
                  isSeq ? "Refine… e.g. show the SCA challenge step on payment > €100" : VIEW_PLACEHOLDER[viewKind]
                }
                disabled={isRefining || output.status === "generating"}
                className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none"
              />
              <button
                type="submit"
                disabled={!refinePrompt.trim() || isRefining || output.status === "generating"}
                className="p-1.5 rounded-lg bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-800 disabled:opacity-30 transition-opacity"
              >
                {isRefining ? <Loader2 size={14} className="animate-spin" /> : <SparklesIcon size={14} />}
              </button>
            </div>
            {refineError && <p className="text-[10px] text-red-500 mt-1 px-3">{refineError}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

export function ArchitectureViewer({ output, onRefine }: ArchitectureViewerProps) {
  return (
    <ReactFlowProvider>
      <ArchitectureInner output={output} onRefine={onRefine} />
    </ReactFlowProvider>
  );
}
