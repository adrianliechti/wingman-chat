import {
  Background,
  BackgroundVariant,
  Controls,
  type EdgeTypes,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Download, FileCode, ImageIcon, Loader2, ShieldCheck, SparklesIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
  const { getNodes, getEdges } = useReactFlow();
  const flowRef = useRef<HTMLDivElement>(null);
  const diagram = output.process;

  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
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

  const exportPng = useCallback(async () => {
    const el = flowRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) return;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(el, {
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false,
      useCORS: true,
      width: el.scrollWidth,
      height: el.scrollHeight,
    });
    const link = document.createElement("a");
    link.download = `${slug(diagram?.title ?? "process")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setShowExport(false);
  }, [diagram]);

  const exportSvg = useCallback(() => {
    if (!flow) return;
    const allNodes = getNodes();
    const allEdges = getEdges();
    const svg = renderSvg(allNodes, allEdges, flow.width, flow.height);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.download = `${slug(diagram?.title ?? "process")}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    setShowExport(false);
  }, [flow, getNodes, getEdges, diagram]);

  if (!diagram || !flow) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-neutral-400">No process diagram</div>
    );
  }

  return (
    <div ref={flowRef} className="h-full w-full relative">
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
        {showDots && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d4d4d4" />}
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      {/* Header: title + summary */}
      <div className="absolute top-2 left-2 right-32 z-10 pointer-events-none">
        <div className="bg-white/85 dark:bg-neutral-900/85 backdrop-blur-sm rounded-xl border border-neutral-200/70 dark:border-neutral-800/70 px-3 py-2 pointer-events-auto max-w-3xl">
          <div className="flex items-center gap-2">
            <ShieldCheck size={13} className="text-neutral-500 shrink-0" />
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 truncate">{diagram.title}</p>
          </div>
          {diagram.summary && (
            <p className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400 mt-1">{diagram.summary}</p>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setShowDots((v) => !v)}
          className="p-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-sm text-[10px] font-medium text-neutral-500"
          title={showDots ? "Hide dot grid" : "Show dot grid"}
        >
          Grid
        </button>
        <button
          type="button"
          onClick={() => setShowExport((v) => !v)}
          className="p-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-sm"
          title="Export"
        >
          <Download size={14} className="text-neutral-500" />
        </button>
      </div>

      {/* Export menu */}
      {showExport && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-[15] cursor-default"
            onClick={() => setShowExport(false)}
          />
          <div className="absolute top-10 right-2 z-20 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-lg p-2 w-44">
            <button
              type="button"
              onClick={exportPng}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left"
            >
              <ImageIcon size={14} className="text-neutral-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">PNG</p>
                <p className="text-[10px] text-neutral-400">High-res image</p>
              </div>
            </button>
            <button
              type="button"
              onClick={exportSvg}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left"
            >
              <FileCode size={14} className="text-neutral-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">SVG</p>
                <p className="text-[10px] text-neutral-400">Vector format</p>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Floating refine prompt */}
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

// ── Helpers ───────────────────────────────────────────────────────────

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Minimal SVG export — captures node bounds + edge straight lines. */
function renderSvg(
  // biome-ignore lint: heterogenous node array from React Flow
  nodes: any[],
  // biome-ignore lint: heterogenous edge array from React Flow
  edges: any[],
  width: number,
  height: number,
): string {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  svg += `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1e293b"/></marker></defs>`;

  // Lane bands
  for (const n of nodes) {
    if (n.type !== "processLane") continue;
    const d = n.data;
    svg += `<rect x="${n.position.x}" y="${n.position.y}" width="${d.width}" height="${d.height}" fill="${d.tint === 0 ? "#fafafa" : "#f4f4f5"}" stroke="#e5e7eb"/>`;
    svg += `<rect x="${n.position.x}" y="${n.position.y}" width="140" height="${d.height}" fill="#ffffff" stroke="#e5e7eb"/>`;
    svg += `<text x="${n.position.x + 70}" y="${n.position.y + d.height / 2}" text-anchor="middle" dominant-baseline="central" fill="#475569" font-size="11" font-weight="600" font-family="system-ui, -apple-system, sans-serif" text-transform="uppercase">${escapeXml(d.label)}</text>`;
  }

  // Edges (straight lines centre-to-centre — good enough for a snapshot)
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) continue;
    const sw = s.data?.width ?? 160;
    const sh = s.data?.height ?? 64;
    const tw = t.data?.width ?? 160;
    const th = t.data?.height ?? 64;
    const sx = s.position.x + sw / 2;
    const sy = s.position.y + sh / 2;
    const tx = t.position.x + tw / 2;
    const ty = t.position.y + th / 2;
    const isMessage = e.data?.flow === "message";
    svg += `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="#1e293b" stroke-width="1.5" ${isMessage ? 'stroke-dasharray="6 4"' : ""} marker-end="url(#arr)"/>`;
    if (e.data?.label) {
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      svg += `<rect x="${mx - 30}" y="${my - 9}" width="60" height="18" rx="4" fill="white" stroke="#e2e8f0"/>`;
      svg += `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" fill="#334155" font-size="10" font-weight="500" font-family="system-ui, -apple-system, sans-serif">${escapeXml(String(e.data.label).slice(0, 24))}</text>`;
    }
  }

  // Nodes
  for (const n of nodes) {
    if (n.type !== "processShape") continue;
    const d = n.data;
    const cx = n.position.x + d.width / 2;
    const cy = n.position.y + d.height / 2;

    if (d.kind === "decision" || d.kind === "parallel") {
      const r = Math.min(d.width, d.height) / 2;
      const fill = d.kind === "decision" ? "#fef9c3" : "#e0e7ff";
      const stroke = d.kind === "decision" ? "#ca8a04" : "#4f46e5";
      svg += `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#1e293b" font-size="${d.kind === "parallel" ? 20 : 10}" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${escapeXml(d.kind === "parallel" ? "+" : String(d.label).slice(0, 18))}</text>`;
    } else if (d.kind === "start" || d.kind === "end" || d.kind === "event") {
      const r = Math.min(d.width, d.height) / 2;
      const fill = d.kind === "start" ? "#dcfce7" : d.kind === "end" ? "#fee2e2" : "#fef3c7";
      const stroke = d.kind === "start" ? "#16a34a" : d.kind === "end" ? "#dc2626" : "#d97706";
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${d.kind === "end" ? 3 : 2}"/>`;
      if (d.kind === "event") {
        svg += `<circle cx="${cx}" cy="${cy}" r="${r - 4}" fill="none" stroke="${stroke}" stroke-width="2"/>`;
      }
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#1e293b" font-size="10" font-weight="500" font-family="system-ui, -apple-system, sans-serif">${escapeXml(String(d.label).slice(0, 16))}</text>`;
    } else {
      // rect for task / subprocess / data
      const rx = d.kind === "subprocess" ? 4 : d.kind === "data" ? 14 : 8;
      svg += `<rect x="${n.position.x}" y="${n.position.y}" width="${d.width}" height="${d.height}" rx="${rx}" fill="${d.kind === "data" ? "#f1f5f9" : "#ffffff"}" stroke="${d.kind === "subprocess" ? "#1e293b" : "#475569"}" stroke-width="${d.kind === "subprocess" ? 2 : 1.5}"/>`;
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="11" font-weight="${d.kind === "subprocess" ? 600 : 500}" font-family="system-ui, -apple-system, sans-serif">${escapeXml(String(d.label).slice(0, 28))}</text>`;
      if (d.control) {
        svg += `<rect x="${n.position.x + d.width - 8}" y="${n.position.y - 6}" width="${Math.max(20, d.control.length * 5)}" height="14" rx="6" fill="#1e293b"/>`;
        svg += `<text x="${n.position.x + d.width - 8 + Math.max(20, d.control.length * 5) / 2}" y="${n.position.y + 1}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="9" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${escapeXml(d.control)}</text>`;
      }
    }
  }

  svg += "</svg>";
  return svg;
}
