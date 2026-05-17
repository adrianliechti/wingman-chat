/**
 * Layout for a process diagram.
 *
 * Lanes run horizontally as bands. Flow runs left→right. Each node is
 * assigned a `layer` (column) via longest-path layering from the start
 * node(s). Within a (lane, layer) cell, nodes are stacked vertically.
 *
 * The output is a flat list of React Flow nodes (lane backgrounds first,
 * shape nodes on top) plus the source/target handles to use for each edge.
 */

import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { ProcessDiagram, ProcessNodeKind } from "../../types/notebook";
import type { ProcessEdgeData } from "./ProcessEdge";
import type { ProcessLaneNodeData } from "./ProcessLaneNode";
import type { ProcessShapeNodeData } from "./ProcessShapeNode";

// ── Constants ─────────────────────────────────────────────────────────

const COL_WIDTH = 220;
const LANE_HEIGHT = 160;
const LANE_LABEL_WIDTH = 140;
const TOP_PADDING = 40;
const LEFT_PADDING = 40;
const RIGHT_PADDING = 80;
const DEFAULT_LANE_ID = "__default__";
const DEFAULT_LANE_LABEL = "Process";

const SHAPE_SIZE: Record<ProcessNodeKind, { width: number; height: number }> = {
  start: { width: 60, height: 60 },
  end: { width: 60, height: 60 },
  event: { width: 60, height: 60 },
  task: { width: 160, height: 64 },
  subprocess: { width: 170, height: 70 },
  decision: { width: 84, height: 84 },
  parallel: { width: 68, height: 68 },
  data: { width: 140, height: 60 },
};

// Per-style lane palettes. The renderer uses lane-index → palette[i % len].
// Palettes are intentionally distinct so the five styles read differently at
// a glance, even when the underlying graph structure is similar.
//   - bpmn        — monochrome (BPMN convention)
//   - swimlane    — soft pastel rainbow (clear role separation)
//   - itil        — ITSM blue / orange / mint / amber tones
//   - sdlc        — cool-to-warm phase ramp
//   - three-lines — risk traffic light: blue / amber / red (1L / 2L / 3L)
const LANE_PALETTES: Record<string, string[]> = {
  bpmn: ["#f8fafc", "#f1f5f9"],
  swimlane: ["#dbeafe", "#fce7f3", "#d1fae5", "#fef3c7", "#e0e7ff", "#fae8ff"],
  itil: ["#dbeafe", "#fed7aa", "#d1fae5", "#fef9c3", "#e0e7ff"],
  sdlc: ["#dbeafe", "#d1fae5", "#fef9c3", "#fed7aa", "#fecaca", "#e0e7ff"],
  "three-lines": ["#bfdbfe", "#fde68a", "#fecaca", "#e9d5ff"],
};
const DEFAULT_PALETTE = LANE_PALETTES.bpmn;

function laneBg(style: string | undefined, laneIndex: number): string {
  const palette = (style && LANE_PALETTES[style]) || DEFAULT_PALETTE;
  return palette[laneIndex % palette.length];
}

// ── Layout helpers ────────────────────────────────────────────────────

interface LayoutInput {
  diagram: ProcessDiagram;
}

interface FlowResult {
  nodes: Node<ProcessShapeNodeData | ProcessLaneNodeData>[];
  edges: Edge<ProcessEdgeData>[];
  /** Total content width, used by callers (fitView, export). */
  width: number;
  /** Total content height. */
  height: number;
}

/** Resolve which lanes appear and in what order. */
function resolveLanes(diagram: ProcessDiagram): { id: string; label: string }[] {
  const declared = diagram.lanes.length > 0 ? diagram.lanes : [];
  const usedIds = new Set<string>();
  for (const n of diagram.nodes) {
    if (n.lane) usedIds.add(n.lane);
  }
  // Keep declared lanes that are actually used, in declared order.
  const keep = declared.filter((l) => usedIds.has(l.id));
  // If any nodes are unlaned, add a default lane at the bottom.
  const hasUnlaned = diagram.nodes.some((n) => !n.lane);
  if (keep.length === 0) {
    return [{ id: DEFAULT_LANE_ID, label: DEFAULT_LANE_LABEL }];
  }
  if (hasUnlaned) {
    keep.push({ id: DEFAULT_LANE_ID, label: "Other" });
  }
  return keep;
}

/** Longest-path layering: layer = 1 + max(layer of predecessors). */
function computeLayers(diagram: ProcessDiagram): Map<string, number> {
  const nodeIds = new Set(diagram.nodes.map((n) => n.id));
  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();
  for (const id of nodeIds) {
    inEdges.set(id, []);
    outEdges.set(id, []);
  }
  for (const e of diagram.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    inEdges.get(e.target)?.push(e.source);
    outEdges.get(e.source)?.push(e.target);
  }

  const layer = new Map<string, number>();

  // Roots: declared `start` nodes plus any node with no incoming edge.
  const roots: string[] = [];
  for (const n of diagram.nodes) {
    if (n.kind === "start" || (inEdges.get(n.id)?.length ?? 0) === 0) {
      roots.push(n.id);
    }
  }
  for (const r of roots) layer.set(r, 0);

  // Relax layers via repeated forward passes. Cycle-safe because we cap
  // iterations at nodeCount and only ever increase a node's layer.
  const order = topologicalOrder(diagram, inEdges, outEdges);
  for (const id of order) {
    const preds = inEdges.get(id) ?? [];
    let maxPred = -1;
    for (const p of preds) {
      const pl = layer.get(p);
      if (pl !== undefined && pl > maxPred) maxPred = pl;
    }
    const proposed = maxPred + 1;
    const current = layer.get(id);
    if (current === undefined || proposed > current) {
      layer.set(id, Math.max(proposed, 0));
    }
  }

  // Any node still missing (disconnected components) → layer 0.
  for (const n of diagram.nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  return layer;
}

/** Kahn-style topological order; falls back to insertion order on cycles. */
function topologicalOrder(
  diagram: ProcessDiagram,
  inEdges: Map<string, string[]>,
  _outEdges: Map<string, string[]>,
): string[] {
  const inDeg = new Map<string, number>();
  for (const n of diagram.nodes) inDeg.set(n.id, inEdges.get(n.id)?.length ?? 0);

  const queue: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);

  const visited = new Set<string>();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const e of diagram.edges) {
      if (e.source === id) {
        const d = (inDeg.get(e.target) ?? 0) - 1;
        inDeg.set(e.target, d);
        if (d <= 0 && !visited.has(e.target)) queue.push(e.target);
      }
    }
  }

  // Append any unvisited nodes (cycles or disconnected) in source order.
  for (const n of diagram.nodes) {
    if (!visited.has(n.id)) order.push(n.id);
  }
  return order;
}

/**
 * Choose source/target handles for an edge based on node positions.
 *
 * `ProcessShapeNode` exposes 8 handles — a source AND a target on each side —
 * with distinct ids: the "natural" side keeps the bare id (`left`, `top`,
 * `right`, `bottom`) for backwards compatibility, the opposite-role handle
 * on the same side uses a `-src` / `-tgt` suffix.
 */
function pickHandles(
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  tx: number,
  ty: number,
  tw: number,
  th: number,
): { sourceHandle: string; targetHandle: string; sourcePosition: Position; targetPosition: Position } {
  const sourceCenterX = sx + sw / 2;
  const sourceCenterY = sy + sh / 2;
  const targetCenterX = tx + tw / 2;
  const targetCenterY = ty + th / 2;
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "right", targetHandle: "left", sourcePosition: Position.Right, targetPosition: Position.Left }
      : {
          sourceHandle: "left-src",
          targetHandle: "right-tgt",
          sourcePosition: Position.Left,
          targetPosition: Position.Right,
        };
  }
  return dy >= 0
    ? {
        sourceHandle: "bottom",
        targetHandle: "top",
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      }
    : {
        sourceHandle: "top-src",
        targetHandle: "bottom-tgt",
        sourcePosition: Position.Top,
        targetPosition: Position.Bottom,
      };
}

// ── Public entry ──────────────────────────────────────────────────────

export function buildProcessFlow({ diagram }: LayoutInput): FlowResult {
  const lanes = resolveLanes(diagram);
  const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));

  const layerMap = computeLayers(diagram);
  const maxLayer = Math.max(0, ...Array.from(layerMap.values()));
  const numCols = maxLayer + 1;

  // Group nodes by (lane, layer) so we can stagger multiples in the same cell.
  const cells = new Map<string, string[]>();
  for (const n of diagram.nodes) {
    const laneId = n.lane && laneIndex.has(n.lane) ? n.lane : DEFAULT_LANE_ID;
    const layer = layerMap.get(n.id) ?? 0;
    const key = `${laneId}::${layer}`;
    const arr = cells.get(key) ?? [];
    arr.push(n.id);
    cells.set(key, arr);
  }

  // Compute node positions.
  const nodePos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [key, ids] of cells) {
    const [laneId, layerStr] = key.split("::");
    const layer = Number(layerStr);
    const lIdx = laneIndex.get(laneId) ?? lanes.length - 1;
    const laneTop = TOP_PADDING + lIdx * LANE_HEIGHT;
    const colCenterX = LEFT_PADDING + LANE_LABEL_WIDTH + layer * COL_WIDTH + COL_WIDTH / 2;

    // Stagger multiple nodes inside a single cell vertically within the lane.
    const stack = ids.length;
    const stride = stack > 1 ? Math.min(64, (LANE_HEIGHT - 24) / stack) : 0;
    const stackTop = laneTop + LANE_HEIGHT / 2 - ((stack - 1) * stride) / 2;

    ids.forEach((id, i) => {
      const node = diagram.nodes.find((n) => n.id === id);
      if (!node) return;
      const size = SHAPE_SIZE[node.kind] ?? SHAPE_SIZE.task;
      const cy = stackTop + i * stride;
      nodePos.set(id, {
        x: Math.round(colCenterX - size.width / 2),
        y: Math.round(cy - size.height / 2),
        w: size.width,
        h: size.height,
      });
    });
  }

  const totalWidth = LEFT_PADDING + LANE_LABEL_WIDTH + numCols * COL_WIDTH + RIGHT_PADDING;
  const totalHeight = TOP_PADDING + lanes.length * LANE_HEIGHT + TOP_PADDING;

  // Build React Flow nodes — lanes first (low z), then shapes.
  const nodes: Node<ProcessShapeNodeData | ProcessLaneNodeData>[] = [];

  lanes.forEach((lane, i) => {
    nodes.push({
      id: `__lane__${lane.id}`,
      type: "processLane",
      position: { x: LEFT_PADDING, y: TOP_PADDING + i * LANE_HEIGHT },
      data: {
        label: lane.label,
        width: totalWidth - LEFT_PADDING - RIGHT_PADDING,
        height: LANE_HEIGHT,
        bg: laneBg(diagram.style, i),
      },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      // Lane backgrounds don't connect to anything.
      connectable: false,
    });
  });

  for (const n of diagram.nodes) {
    const pos = nodePos.get(n.id);
    if (!pos) continue;
    nodes.push({
      id: n.id,
      type: "processShape",
      position: { x: pos.x, y: pos.y },
      data: {
        label: n.label,
        kind: n.kind,
        description: n.description,
        control: n.control,
        width: pos.w,
        height: pos.h,
      },
      draggable: true,
      zIndex: 10,
    });
  }

  // Edges with handles picked from final positions.
  const edges: Edge<ProcessEdgeData>[] = [];
  for (const e of diagram.edges) {
    const s = nodePos.get(e.source);
    const t = nodePos.get(e.target);
    if (!s || !t) continue;
    const h = pickHandles(s.x, s.y, s.w, s.h, t.x, t.y, t.w, t.h);
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: h.sourceHandle,
      targetHandle: h.targetHandle,
      type: "process",
      data: { label: e.label, flow: e.flow ?? "sequence" },
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#1e293b" },
    });
  }

  return { nodes, edges, width: totalWidth, height: totalHeight };
}
