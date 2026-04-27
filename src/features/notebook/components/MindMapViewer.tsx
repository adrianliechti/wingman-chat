import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeOrigin,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Download, FileCode, ImageIcon, Settings2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { MindMapNode } from "../types/notebook";
import { MindMapCustomEdge } from "./mindmap/MindMapEdge";
import { MindMapCustomNode, type MindMapNodeData } from "./mindmap/MindMapNode";

// ── Types ─────────────────────────────────────────────────────────────

interface MindMapViewerProps {
  root: MindMapNode;
}

type LayoutDirection = "radial" | "vertical" | "horizontal";

// ── Colors ────────────────────────────────────────────────────────────

const BRANCH_COLORS = [
  { bg: "#3b82f6", light: "#eff6ff", border: "#93bbfd", text: "#1e40af" },
  { bg: "#10b981", light: "#ecfdf5", border: "#6ee7b7", text: "#065f46" },
  { bg: "#f59e0b", light: "#fffbeb", border: "#fcd34d", text: "#92400e" },
  { bg: "#8b5cf6", light: "#f5f3ff", border: "#c4b5fd", text: "#5b21b6" },
  { bg: "#f43f5e", light: "#fff1f2", border: "#fda4af", text: "#9f1239" },
  { bg: "#06b6d4", light: "#ecfeff", border: "#67e8f9", text: "#155e75" },
  { bg: "#f97316", light: "#fff7ed", border: "#fdba74", text: "#9a3412" },
];

// ── Layout helpers ────────────────────────────────────────────────────

const LAYER_SPACING = 220;
const TREE_X = 200;
const TREE_Y = 100;

interface FlatNode {
  id: string;
  label: string;
  depth: number;
  colorIndex: number;
  parentId: string | null;
}

function flattenTree(root: MindMapNode) {
  const nodes: FlatNode[] = [];
  const edges: { id: string; source: string; target: string; colorIndex: number }[] = [];
  let counter = 0;

  function walk(node: MindMapNode, depth: number, parentId: string | null, colorIndex: number) {
    const id = `mm-${counter++}`;
    nodes.push({ id, label: node.label, depth, colorIndex, parentId });
    if (parentId) edges.push({ id: `e-${parentId}-${id}`, source: parentId, target: id, colorIndex });
    node.children?.forEach((child, i) => {
      walk(child, depth + 1, id, depth === 0 ? i % BRANCH_COLORS.length : colorIndex);
    });
  }

  walk(root, 0, null, 0);
  return { nodes, edges };
}

function leafCount(node: MindMapNode): number {
  if (!node.children?.length) return 1;
  return node.children.reduce((s, c) => s + leafCount(c), 0);
}

function radialPositions(root: MindMapNode, flat: FlatNode[]) {
  const pos = new Map<string, { x: number; y: number }>();
  let idx = 0;

  function walk(node: MindMapNode, depth: number, aStart: number, aEnd: number) {
    const id = `mm-${idx++}`;
    const mid = (aStart + aEnd) / 2;
    const r = depth * LAYER_SPACING;
    pos.set(id, { x: depth === 0 ? 0 : Math.cos(mid) * r, y: depth === 0 ? 0 : Math.sin(mid) * r });

    if (node.children?.length) {
      const total = node.children.reduce((s, c) => s + leafCount(c), 0);
      let cur = aStart;
      for (const child of node.children) {
        const span = ((aEnd - aStart) * leafCount(child)) / total;
        walk(child, depth + 1, cur, cur + span);
        cur += span;
      }
    }
  }

  walk(root, 0, 0, 2 * Math.PI);
  return flat.map((n) => pos.get(n.id) ?? { x: 0, y: 0 });
}

function treePositions(root: MindMapNode, flat: FlatNode[], dir: "vertical" | "horizontal") {
  const pos = new Map<string, { x: number; y: number }>();
  let leaf = 0;

  function walk(node: MindMapNode, depth: number, idx: number): number {
    const id = `mm-${idx}`;
    let next = idx + 1;

    if (!node.children?.length) {
      const lp = leaf++;
      pos.set(
        id,
        dir === "vertical" ? { x: lp * TREE_X, y: depth * TREE_Y * 1.5 } : { x: depth * TREE_X * 1.5, y: lp * TREE_Y },
      );
      return next;
    }

    const cp: { x: number; y: number }[] = [];
    for (const child of node.children) {
      const cid = `mm-${next}`;
      next = walk(child, depth + 1, next);
      const p = pos.get(cid);
      if (p) cp.push(p);
    }

    const ax = cp.reduce((s, p) => s + p.x, 0) / cp.length;
    const ay = cp.reduce((s, p) => s + p.y, 0) / cp.length;
    pos.set(id, dir === "vertical" ? { x: ax, y: depth * TREE_Y * 1.5 } : { x: depth * TREE_X * 1.5, y: ay });
    return next;
  }

  walk(root, 0, 0);
  return flat.map((n) => pos.get(n.id) ?? { x: 0, y: 0 });
}

// ── Build React Flow data ─────────────────────────────────────────────

function buildFlowData(root: MindMapNode, dir: LayoutDirection): { nodes: Node<MindMapNodeData>[]; edges: Edge[] } {
  const { nodes: flat, edges: flatEdges } = flattenTree(root);
  const positions = dir === "radial" ? radialPositions(root, flat) : treePositions(root, flat, dir);

  return {
    nodes: flat.map((n, i) => ({
      id: n.id,
      type: "mindmap" as const,
      position: positions[i],
      data: { label: n.label, depth: n.depth, colorIndex: n.colorIndex, colors: BRANCH_COLORS },
      draggable: true,
    })),
    edges: flatEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "mindmap" as const,
      data: { colorIndex: e.colorIndex, colors: BRANCH_COLORS },
    })),
  };
}

// ── Static config ─────────────────────────────────────────────────────

const nodeTypes: NodeTypes = { mindmap: MindMapCustomNode };
const edgeTypes: EdgeTypes = { mindmap: MindMapCustomEdge };
const nodeOrigin: NodeOrigin = [0.5, 0.5];
const proOptions = { hideAttribution: true };

// ── SVG helpers ───────────────────────────────────────────────────────

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Inner component ───────────────────────────────────────────────────

function MindMapInner({ root }: MindMapViewerProps) {
  const { getNodes, getEdges } = useReactFlow();
  const flowRef = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<LayoutDirection>("radial");
  const [showConfig, setShowConfig] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showDots, setShowDots] = useState(true);

  const { nodes, edges } = useMemo(() => buildFlowData(root, direction), [root, direction]);

  const exportPng = useCallback(async () => {
    const el = flowRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) return;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(el, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true,
      width: el.scrollWidth,
      height: el.scrollHeight,
    });
    const link = document.createElement("a");
    link.download = "mindmap.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setShowExport(false);
  }, []);

  const exportSvg = useCallback(() => {
    const allNodes = getNodes();
    const allEdges = getEdges();
    const pad = 60;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of allNodes) {
      const w = n.measured?.width ?? 160;
      const h = n.measured?.height ?? 40;
      x0 = Math.min(x0, n.position.x - w / 2);
      y0 = Math.min(y0, n.position.y - h / 2);
      x1 = Math.max(x1, n.position.x + w / 2);
      y1 = Math.max(y1, n.position.y + h / 2);
    }

    const W = x1 - x0 + pad * 2;
    const H = y1 - y0 + pad * 2;
    const ox = -x0 + pad;
    const oy = -y0 + pad;
    const nm = new Map(allNodes.map((n) => [n.id, n]));

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    svg += `<rect width="${W}" height="${H}" fill="#fafafa"/>`;

    for (const e of allEdges) {
      const s = nm.get(e.source),
        t = nm.get(e.target);
      if (!s || !t) continue;
      const ci = (e.data as { colorIndex?: number })?.colorIndex ?? 0;
      svg += `<line x1="${s.position.x + ox}" y1="${s.position.y + oy}" x2="${t.position.x + ox}" y2="${t.position.y + oy}" stroke="${BRANCH_COLORS[ci % BRANCH_COLORS.length].bg}" stroke-width="2" stroke-opacity="0.5" stroke-linecap="round"/>`;
    }

    for (const n of allNodes) {
      const d = n.data as MindMapNodeData;
      const w = n.measured?.width ?? 160;
      const h = n.measured?.height ?? 40;
      const cx = n.position.x + ox,
        cy = n.position.y + oy;
      const rx = cx - w / 2,
        ry = cy - h / 2;
      const c = BRANCH_COLORS[d.colorIndex % BRANCH_COLORS.length];

      if (d.depth === 0) {
        svg += `<rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="16" fill="#262626"/>`;
        svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="16" font-weight="700">${escapeXml(d.label)}</text>`;
      } else if (d.depth === 1) {
        svg += `<rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="12" fill="${c.bg}"/>`;
        svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="13" font-weight="600">${escapeXml(d.label)}</text>`;
      } else {
        svg += `<rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="10" fill="${c.light}" stroke="${c.border}" stroke-width="1.5"/>`;
        svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="${c.text}" font-size="12" font-weight="500">${escapeXml(d.label)}</text>`;
      }
    }

    svg += "</svg>";
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.download = "mindmap.svg";
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    setShowExport(false);
  }, [getNodes, getEdges]);

  return (
    <div ref={flowRef} className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={nodeOrigin}
        proOptions={proOptions}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.1}
        maxZoom={2}
      >
        {showDots && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d4d4d4" />}
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      {/* Toolbar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setShowConfig((v) => !v);
            setShowExport(false);
          }}
          className="p-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-sm"
          title="Settings"
        >
          <Settings2 size={14} className="text-neutral-500" />
        </button>
        <button
          type="button"
          onClick={() => {
            setShowExport((v) => !v);
            setShowConfig(false);
          }}
          className="p-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-sm"
          title="Export"
        >
          <Download size={14} className="text-neutral-500" />
        </button>
      </div>

      {/* Config popup */}
      {showConfig && (
        <div className="absolute top-10 left-2 z-20 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-lg p-3 w-52">
          <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
            Layout
          </p>
          <div className="space-y-1">
            {(
              [
                ["radial", "Radial"],
                ["vertical", "Top-Down"],
                ["horizontal", "Left-Right"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setDirection(v);
                  setShowConfig(false);
                }}
                className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors ${direction === v ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showDots}
                onChange={(e) => setShowDots(e.target.checked)}
                className="rounded border-neutral-300 dark:border-neutral-600"
              />
              Show dot grid
            </label>
          </div>
        </div>
      )}

      {/* Export popup */}
      {showExport && (
        <div className="absolute top-10 left-12 z-20 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-lg p-2 w-44">
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
      )}

      {/* Click-away */}
      {(showConfig || showExport) && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[15] cursor-default"
          onClick={() => {
            setShowConfig(false);
            setShowExport(false);
          }}
        />
      )}
    </div>
  );
}

// ── Public wrapper ────────────────────────────────────────────────────

export function MindMapViewer({ root }: MindMapViewerProps) {
  return (
    <ReactFlowProvider>
      <MindMapInner root={root} />
    </ReactFlowProvider>
  );
}
