import { useMemo, useCallback, memo } from "react";
import { ReactFlow, Controls, type Node, type Edge, type NodeProps, Handle, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MindMapNode } from "../types/notebook";

interface MindMapViewerProps {
  root: MindMapNode;
}

// ── Colors ─────────────────────────────────────────────────────────────

const COLORS = [
  { bg: "#3b82f6", light: "#eff6ff", border: "#93bbfd", text: "#1e40af" },
  { bg: "#10b981", light: "#ecfdf5", border: "#6ee7b7", text: "#065f46" },
  { bg: "#f59e0b", light: "#fffbeb", border: "#fcd34d", text: "#92400e" },
  { bg: "#8b5cf6", light: "#f5f3ff", border: "#c4b5fd", text: "#5b21b6" },
  { bg: "#f43f5e", light: "#fff1f2", border: "#fda4af", text: "#9f1239" },
  { bg: "#06b6d4", light: "#ecfeff", border: "#67e8f9", text: "#155e75" },
  { bg: "#f97316", light: "#fff7ed", border: "#fdba74", text: "#9a3412" },
];

// ── Layout: radial tree ────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  label: string;
  depth: number;
  colorIndex: number;
  x: number;
  y: number;
  parentId: string | null;
}

function layoutTree(root: MindMapNode): { nodes: LayoutNode[]; edges: Edge[] } {
  const layoutNodes: LayoutNode[] = [];
  const edges: Edge[] = [];
  let idCounter = 0;

  // First pass: count leaves for angle allocation
  function countLeaves(node: MindMapNode): number {
    if (!node.children || node.children.length === 0) return 1;
    return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
  }

  const LAYER_SPACING = 200;

  function traverse(
    node: MindMapNode,
    depth: number,
    angleStart: number,
    angleEnd: number,
    parentId: string | null,
    colorIndex: number,
  ) {
    const id = `node-${idCounter++}`;
    const angleMid = (angleStart + angleEnd) / 2;
    const radius = depth * LAYER_SPACING;

    const x = depth === 0 ? 0 : Math.cos(angleMid) * radius;
    const y = depth === 0 ? 0 : Math.sin(angleMid) * radius;

    layoutNodes.push({ id, label: node.label, depth, colorIndex, x, y, parentId });

    if (parentId) {
      edges.push({
        id: `edge-${parentId}-${id}`,
        source: parentId,
        target: id,
        type: "default",
        style: {
          stroke: COLORS[colorIndex % COLORS.length].bg,
          strokeWidth: Math.max(1.5, 3 - depth * 0.5),
          opacity: 0.5,
        },
        animated: false,
      });
    }

    if (node.children && node.children.length > 0) {
      const totalLeaves = node.children.reduce((s, c) => s + countLeaves(c), 0);
      let currentAngle = angleStart;

      node.children.forEach((child, i) => {
        const childLeaves = countLeaves(child);
        const childAngleSpan = ((angleEnd - angleStart) * childLeaves) / totalLeaves;
        const childColor = depth === 0 ? i % COLORS.length : colorIndex;

        traverse(child, depth + 1, currentAngle, currentAngle + childAngleSpan, id, childColor);
        currentAngle += childAngleSpan;
      });
    }
  }

  traverse(root, 0, 0, 2 * Math.PI, null, 0);
  return { nodes: layoutNodes, edges };
}

// ── Custom Node Components ─────────────────────────────────────────────

type MindMapNodeData = {
  label: string;
  depth: number;
  colorIndex: number;
};

const RootNode = memo(({ data }: NodeProps<Node<MindMapNodeData>>) => (
  <div className="px-5 py-3 bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-2xl shadow-lg text-base font-bold text-center min-w-[80px] select-none">
    {data.label}
    <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
    <Handle type="source" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
    <Handle type="source" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
    <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
  </div>
));

const BranchNode = memo(({ data }: NodeProps<Node<MindMapNodeData>>) => {
  const color = COLORS[data.colorIndex % COLORS.length];
  const isMajor = data.depth === 1;

  return (
    <div
      className="rounded-xl shadow-sm text-center select-none transition-shadow hover:shadow-md"
      style={{
        padding: isMajor ? "8px 16px" : "5px 12px",
        backgroundColor: isMajor ? color.bg : color.light,
        color: isMajor ? "#fff" : color.text,
        border: isMajor ? "none" : `1.5px solid ${color.border}`,
        fontSize: isMajor ? "13px" : "12px",
        fontWeight: isMajor ? 600 : 500,
        minWidth: "60px",
        maxWidth: "180px",
        wordBreak: "break-word" as const,
      }}
    >
      {data.label}
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </div>
  );
});

const nodeTypes = {
  root: RootNode,
  branch: BranchNode,
};

// ── Main Component ─────────────────────────────────────────────────────

export function MindMapViewer({ root }: MindMapViewerProps) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const { nodes, edges } = layoutTree(root);

    const flowNodes: Node<MindMapNodeData>[] = nodes.map((n) => ({
      id: n.id,
      type: n.depth === 0 ? "root" : "branch",
      position: { x: n.x, y: n.y },
      data: {
        label: n.label,
        depth: n.depth,
        colorIndex: n.colorIndex,
      },
      draggable: true,
    }));

    return { flowNodes, flowEdges: edges };
  }, [root]);

  const onInit = useCallback((instance: { fitView: (opts?: object) => void }) => {
    setTimeout(() => instance.fitView({ padding: 0.3 }), 50);
  }, []);

  return (
    <div className="h-full w-full" style={{ background: "transparent" }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Controls
          showInteractive={false}
          className="!bg-white dark:!bg-neutral-800 !border-neutral-200 dark:!border-neutral-700 !shadow-md !rounded-lg [&>button]:!bg-white dark:[&>button]:!bg-neutral-800 [&>button]:!border-neutral-200 dark:[&>button]:!border-neutral-700 [&>button]:!text-neutral-600 dark:[&>button]:!text-neutral-400"
        />
      </ReactFlow>
    </div>
  );
}
