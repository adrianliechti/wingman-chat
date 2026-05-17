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
import { Loader2, ShieldCheck, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { refineProcess } from "../lib/process-refine";
import type { NotebookOutput } from "../types/notebook";
import { ProcessCustomEdge } from "./process/ProcessEdge";
import { ProcessLaneNode } from "./process/ProcessLaneNode";
import { ProcessShapeNode } from "./process/ProcessShapeNode";
import { buildProcessFlow } from "./process/layout";

interface ProcessViewerProps {
  output: NotebookOutput;
  onRefine?: (updatedOutput: NotebookOutput) => void;
}

const nodeTypes: NodeTypes = {
  processShape: ProcessShapeNode,
  processLane: ProcessLaneNode,
};
const edgeTypes: EdgeTypes = {
  process: ProcessCustomEdge,
};
const proOptions = { hideAttribution: true };

// ── Inner component ───────────────────────────────────────────────────

function ProcessInner({ output, onRefine }: ProcessViewerProps) {
  const diagram = output.process;

  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [showDots, setShowDots] = useState(true);

  const flow = useMemo(() => (diagram ? buildProcessFlow({ diagram }) : null), [diagram]);

  const handleRefineSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!refinePrompt.trim() || isRefining || !diagram) return;
    setIsRefining(true);
    setRefineError(null);
    try {
      const updated = await refineProcess(output, refinePrompt.trim());
      if (updated !== output) {
        onRefine?.(updated);
      }
      setRefinePrompt("");
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  };

  if (!diagram || !flow) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-neutral-400">No process diagram</div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-neutral-950">
      {/* Header — in document flow so content never slides under it. */}
      <header className="shrink-0 flex items-start gap-3 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={13} className="text-neutral-500 shrink-0" />
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 truncate">{diagram.title}</p>
          </div>
          {diagram.summary && (
            <p className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
              {diagram.summary}
            </p>
          )}
        </div>
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
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 relative">
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

        {/* Refine */}
        <div className="absolute bottom-4 left-4 right-4 z-20">
          <form onSubmit={handleRefineSubmit}>
            <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-neutral-700/40 shadow-lg shadow-black/5 dark:shadow-black/20 p-3">
              <input
                type="text"
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                placeholder="Refine this process… e.g. add a four-eye approval before posting"
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

// ── Public wrapper ────────────────────────────────────────────────────

export function ProcessViewer({ output, onRefine }: ProcessViewerProps) {
  return (
    <ReactFlowProvider>
      <ProcessInner output={output} onRefine={onRefine} />
    </ReactFlowProvider>
  );
}

