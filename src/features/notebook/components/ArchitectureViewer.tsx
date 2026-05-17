import {
  Background,
  BackgroundVariant,
  Controls,
  type EdgeTypes,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Boxes, Loader2, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { refineArchitecture } from "../lib/architecture-refine";
import type { NotebookOutput } from "../types/notebook";
import { ArchitectureGroupNode } from "./architecture/ArchitectureGroupNode";
import { ArchitectureRelationEdge } from "./architecture/ArchitectureRelationEdge";
import { ArchitectureShapeNode } from "./architecture/ArchitectureShapeNode";
import { SequenceCanvas } from "./architecture/SequenceCanvas";
import { buildArchitectureFlow, isSequenceDiagram } from "./architecture/graphLayout";

interface ArchitectureViewerProps {
  output: NotebookOutput;
  onRefine?: (updatedOutput: NotebookOutput) => void;
}

const nodeTypes: NodeTypes = {
  architectureShape: ArchitectureShapeNode,
  architectureGroup: ArchitectureGroupNode,
};
const edgeTypes: EdgeTypes = {
  architectureRelation: ArchitectureRelationEdge,
};
const proOptions = { hideAttribution: true };

const KIND_LABEL: Record<string, string> = {
  "c4-context": "C4 Context",
  "c4-container": "C4 Container",
  "c4-component": "C4 Component",
  deployment: "Deployment",
  sequence: "Sequence",
  erd: "ERD",
};

function ArchitectureInner({ output, onRefine }: ArchitectureViewerProps) {
  const diagram = output.architecture;

  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [showDots, setShowDots] = useState(true);

  const flow = useMemo(
    () => (diagram && !isSequenceDiagram(diagram) ? buildArchitectureFlow(diagram) : null),
    [diagram],
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

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-neutral-950">
      {/* Header — in document flow so content never slides under it. */}
      <header className="shrink-0 flex items-start gap-3 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Boxes size={13} className="text-neutral-500 shrink-0" />
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 truncate">{diagram.title}</p>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 uppercase tracking-wider shrink-0">
              {KIND_LABEL[diagram.kind] ?? diagram.kind}
            </span>
          </div>
          {diagram.summary && (
            <p className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
              {diagram.summary}
            </p>
          )}
        </div>
        {!isSeq && (
          <div className="shrink-0 flex items-center gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => setShowDots((v) => !v)}
              className={`px-2 py-1 rounded-lg border transition-colors text-[10px] font-semibold tracking-wide ${
                showDots
                  ? "bg-neutral-800 dark:bg-neutral-200 border-neutral-800 dark:border-neutral-200 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
              title={showDots ? "Hide dot grid" : "Show dot grid"}
              aria-pressed={showDots}
            >
              Grid
            </button>
          </div>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 relative">
        {isSeq ? (
          <div className="h-full w-full overflow-auto bg-white">
            <SequenceCanvas diagram={diagram} />
          </div>
        ) : flow ? (
          <ReactFlow
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
            {showDots && <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#94a3b8" />}
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        ) : null}

        {/* Refine */}
        <div className="absolute bottom-4 left-4 right-4 z-20">
          <form onSubmit={handleRefineSubmit}>
            <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-neutral-700/40 shadow-lg shadow-black/5 dark:shadow-black/20 p-3">
              <input
                type="text"
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                placeholder={placeholderFor(diagram.kind)}
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

function placeholderFor(kind: string): string {
  switch (kind) {
    case "c4-context":
      return "Refine… e.g. add the regulator reporting feed as an external system";
    case "c4-container":
      return "Refine… e.g. add a Redis cache between API and core banking";
    case "c4-component":
      return "Refine… e.g. extract validation into a dedicated component";
    case "deployment":
      return "Refine… e.g. add a DR region in eu-west-1 with async replication";
    case "sequence":
      return "Refine… e.g. show the SCA challenge step on payment > €100";
    case "erd":
      return "Refine… e.g. split address into a separate entity";
    default:
      return "Refine this diagram…";
  }
}

