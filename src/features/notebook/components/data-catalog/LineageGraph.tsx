/**
 * OpenLineage-aligned DAG renderer.
 *
 * Layered placement (Sugiyama-like): sources on the left, jobs in the middle,
 * sinks on the right. Layers come from longest-path BFS from in-degree-zero
 * nodes. Within a layer, nodes are stacked vertically.
 */

import {
  Controls,
  type Edge,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  type EdgeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { DataCatalog, LineageEdge, LineageNode } from "../../types/notebook";

interface LineageGraphProps {
  catalog: DataCatalog;
}

// ── Visual constants ──────────────────────────────────────────────────

const COL_WIDTH = 240;
const ROW_HEIGHT = 110;
const TOP_PADDING = 60;
const LEFT_PADDING = 40;

const NODE_SIZE = {
  dataset: { width: 180, height: 80 },
  job: { width: 200, height: 70 },
  external: { width: 170, height: 70 },
};

interface LineageNodeData {
  node: LineageNode;
  width: number;
  height: number;
  systemHint?: string;
  [key: string]: unknown;
}

interface LineageEdgeData {
  label?: string;
  kind?: LineageEdge["kind"];
  inferred: boolean;
  [key: string]: unknown;
}

// ── Custom node ───────────────────────────────────────────────────────

const HANDLE_STYLE: React.CSSProperties = { opacity: 0, pointerEvents: "none" };

function LineageNodeRenderer({ data }: NodeProps) {
  const d = data as unknown as LineageNodeData;
  const { node, width, height, systemHint } = d;
  const isDataset = node.kind === "dataset";
  const isJob = node.kind === "job";

  const style = isDataset
    ? { bg: "#dbeafe", border: "#2563eb", ink: "#1e3a8a", rx: 8 }
    : isJob
      ? { bg: "#fed7aa", border: "#ea580c", ink: "#7c2d12", rx: 4 }
      : { bg: "#e5e7eb", border: "#6b7280", ink: "#1f2937", rx: 8 };

  return (
    <div
      style={{
        width,
        height,
        background: style.bg,
        border: `${node.inferred ? "1.5px dashed" : "1.5px solid"} ${style.border}`,
        borderRadius: style.rx,
        color: style.ink,
        boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
        padding: 8,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        textAlign: "center",
        position: "relative",
        boxSizing: "border-box",
      }}
      title={node.description ?? undefined}
    >
      <Handle type="target" position={Position.Left} id="left" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id="right" style={HANDLE_STYLE} />

      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          opacity: 0.7,
          marginBottom: 2,
        }}
      >
        {node.kind}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{node.label}</div>
      {(node.technology ?? systemHint) && (
        <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.75, marginTop: 2 }}>
          [{node.technology ?? systemHint}]
        </div>
      )}
      {node.inferred && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: 0.4,
            opacity: 0.7,
          }}
        >
          INFERRED
        </span>
      )}
    </div>
  );
}

// ── Custom edge ───────────────────────────────────────────────────────

const EDGE_STROKE: Record<NonNullable<LineageEdge["kind"]>, string> = {
  ingest: "#16a34a",
  transform: "#1e293b",
  publish: "#9333ea",
  replicate: "#0891b2",
};

function labelYStagger(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 5) - 2) * 12;
}

function LineageEdgeRenderer(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const d = data as LineageEdgeData | undefined;
  const stroke = d?.kind ? EDGE_STROKE[d.kind] : "#1e293b";
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  const labelYAdj = labelY + labelYStagger(id);
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: d?.inferred ? "#94a3b8" : stroke,
          strokeWidth: 1.5,
          strokeDasharray: d?.inferred ? "6 4" : undefined,
        }}
        markerEnd={markerEnd}
      />
      {d?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelYAdj}px)`,
              background: "white",
              padding: "1px 6px",
              borderRadius: 4,
              border: "1px solid #e2e8f0",
              fontSize: 10,
              color: "#334155",
              pointerEvents: "all",
              whiteSpace: "nowrap",
              maxWidth: 150,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            className="nodrag nopan"
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes: NodeTypes = { lineageNode: LineageNodeRenderer };
const edgeTypes: EdgeTypes = { lineageEdge: LineageEdgeRenderer };
const proOptions = { hideAttribution: true };

// ── Layout ────────────────────────────────────────────────────────────

function buildFlow(catalog: DataCatalog): { nodes: Node<LineageNodeData>[]; edges: Edge<LineageEdgeData>[] } {
  const nodes = catalog.lineageNodes;
  const edges = catalog.lineageEdges;

  if (nodes.length === 0) return { nodes: [], edges: [] };

  // Index for dataset system hints.
  const datasetById = new Map(catalog.datasets.map((d) => [d.id, d]));

  // Compute layer (longest path) — sources at layer 0.
  const inEdges = new Map<string, string[]>();
  for (const n of nodes) inEdges.set(n.id, []);
  for (const e of edges) inEdges.get(e.target)?.push(e.source);

  // Kahn topological order — falls back to insertion order on cycles.
  const inDeg = new Map<string, number>();
  for (const n of nodes) inDeg.set(n.id, inEdges.get(n.id)?.length ?? 0);
  const queue: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);
  const order: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const e of edges) {
      if (e.source === id) {
        const d = (inDeg.get(e.target) ?? 0) - 1;
        inDeg.set(e.target, d);
        if (d <= 0 && !visited.has(e.target)) queue.push(e.target);
      }
    }
  }
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id);

  const layer = new Map<string, number>();
  for (const id of order) {
    const preds = inEdges.get(id) ?? [];
    let max = -1;
    for (const p of preds) max = Math.max(max, layer.get(p) ?? 0);
    layer.set(id, max + 1);
  }

  // Group by layer, sub-position vertically.
  const perLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = perLayer.get(l) ?? [];
    arr.push(n.id);
    perLayer.set(l, arr);
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [l, ids] of perLayer) {
    ids.forEach((id, i) => {
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      const size = NODE_SIZE[n.kind];
      pos.set(id, {
        x: LEFT_PADDING + l * COL_WIDTH,
        y: TOP_PADDING + i * ROW_HEIGHT,
        w: size.width,
        h: size.height,
      });
    });
  }

  const flowNodes: Node<LineageNodeData>[] = nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: 0, y: 0, w: NODE_SIZE.dataset.width, h: NODE_SIZE.dataset.height };
    const systemHint = n.datasetId ? datasetById.get(n.datasetId)?.system : undefined;
    return {
      id: n.id,
      type: "lineageNode",
      position: { x: p.x, y: p.y },
      data: { node: n, width: p.w, height: p.h, systemHint },
      draggable: true,
    };
  });

  const flowEdges: Edge<LineageEdgeData>[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "lineageEdge",
    data: { label: e.label, kind: e.kind, inferred: e.inferred ?? false },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: e.inferred ? "#94a3b8" : "#1e293b" },
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

// ── Public ────────────────────────────────────────────────────────────

export function LineageGraph({ catalog }: LineageGraphProps) {
  const flow = useMemo(() => buildFlow(catalog), [catalog]);

  if (flow.nodes.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-neutral-400">
        No lineage in this catalog — switch view or refine to add some.
      </div>
    );
  }

  return (
    <ReactFlowProvider>
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
    </ReactFlowProvider>
  );
}
