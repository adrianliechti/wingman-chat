import { Controls, type EdgeTypes, type NodeTypes, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, SparklesIcon } from "lucide-react";
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
    <div className="h-full w-full flex flex-col">
      {/* No header — title lives in the StudioPanel row + preview chrome. */}
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
          {/* Lift controls above the floating refine input. */}
          <Controls showInteractive={false} position="bottom-left" style={{ bottom: 80 }} />
        </ReactFlow>

        {/* Refine */}
        <div className="absolute bottom-4 left-3 right-3 z-20">
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
            {refineError && <p className="text-xs text-red-500 mt-1 px-3">{refineError}</p>}
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
