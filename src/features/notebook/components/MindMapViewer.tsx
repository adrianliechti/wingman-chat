import { useMemo } from "react";
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

interface LayoutEdge {
  id: string;
  sourceId: string;
  targetId: string;
  depth: number;
  colorIndex: number;
}

interface RenderNode extends LayoutNode {
  width: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  lines: Array<{ id: string; text: string }>;
  renderX: number;
  renderY: number;
}

interface RenderEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

const LAYER_SPACING = 200;
const SCENE_PADDING = 120;

function layoutTree(root: MindMapNode): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const layoutNodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let idCounter = 0;

  // First pass: count leaves for angle allocation
  function countLeaves(node: MindMapNode): number {
    if (!node.children || node.children.length === 0) return 1;
    return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
  }

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
        sourceId: parentId,
        targetId: id,
        depth,
        colorIndex,
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

// ── Rendering helpers ──────────────────────────────────────────────────

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function splitLongWord(word: string, maxCharsPerLine: number) {
  if (word.length <= maxCharsPerLine) {
    return [word];
  }

  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxCharsPerLine) {
    chunks.push(word.slice(index, index + maxCharsPerLine));
  }
  return chunks;
}

function wrapLabel(label: string, maxCharsPerLine: number) {
  const words = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => splitLongWord(word, maxCharsPerLine));

  if (words.length === 0) {
    return [label || " "];
  }

  const lines: string[] = [];
  let currentLine = words[0] ?? "";

  for (const word of words.slice(1)) {
    if (`${currentLine} ${word}`.length <= maxCharsPerLine) {
      currentLine = `${currentLine} ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  lines.push(currentLine);
  return lines;
}

function measureNode(node: LayoutNode) {
  const isRoot = node.depth === 0;
  const isMajor = node.depth === 1;
  const maxCharsPerLine = isRoot ? 16 : isMajor ? 18 : 22;
  const wrappedLines = wrapLabel(node.label, maxCharsPerLine);
  const lineCounts = new Map<string, number>();
  const lines = wrappedLines.map((text) => {
    const occurrence = (lineCounts.get(text) ?? 0) + 1;
    lineCounts.set(text, occurrence);
    return { id: `${text}-${occurrence}`, text };
  });
  const fontSize = isRoot ? 16 : isMajor ? 13 : 12;
  const fontWeight = isRoot ? 700 : isMajor ? 600 : 500;
  const lineHeight = isRoot ? 20 : isMajor ? 18 : 16;
  const paddingX = isRoot ? 20 : isMajor ? 16 : 12;
  const paddingY = isRoot ? 14 : isMajor ? 10 : 8;
  const minWidth = isRoot ? 100 : isMajor ? 92 : 72;
  const maxWidth = isRoot ? 200 : isMajor ? 190 : 210;
  const longestLine = Math.max(...lines.map((line) => line.text.length), 1);
  const width = clamp(longestLine * fontSize * 0.62 + paddingX * 2, minWidth, maxWidth);
  const height = lines.length * lineHeight + paddingY * 2;

  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    fontSize,
    fontWeight,
    lineHeight,
    paddingX,
    paddingY,
    lines,
  };
}

function getConnectorPoint(node: RenderNode, targetX: number, targetY: number) {
  const dx = targetX - node.renderX;
  const dy = targetY - node.renderY;

  if (dx === 0 && dy === 0) {
    return { x: node.renderX, y: node.renderY };
  }

  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);

  return {
    x: node.renderX + dx * scale,
    y: node.renderY + dy * scale,
  };
}

function MindMapCard({ node }: { node: RenderNode }) {
  const isRoot = node.depth === 0;
  const isMajor = node.depth === 1;
  const color = COLORS[node.colorIndex % COLORS.length];

  return (
    <div
      className={`absolute pointer-events-none flex -translate-x-1/2 -translate-y-1/2 select-none flex-col justify-center text-center ${
        isRoot ? "rounded-2xl bg-neutral-800 text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900" : "rounded-xl shadow-sm"
      }`}
      style={{
        left: node.renderX,
        top: node.renderY,
        width: node.width,
        height: node.height,
        boxSizing: "border-box",
        padding: `${node.paddingY}px ${node.paddingX}px`,
        backgroundColor: isRoot ? undefined : isMajor ? color.bg : color.light,
        color: isRoot ? undefined : isMajor ? "#fff" : color.text,
        border: isRoot || isMajor ? "none" : `1.5px solid ${color.border}`,
        fontSize: `${node.fontSize}px`,
        fontWeight: node.fontWeight,
        lineHeight: `${node.lineHeight}px`,
      }}
    >
      {node.lines.map((line) => (
        <span key={line.id} className="block">
          {line.text}
        </span>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function MindMapViewer({ root }: MindMapViewerProps) {
  const { renderNodes, renderEdges, sceneWidth, sceneHeight } = useMemo(() => {
    const { nodes, edges } = layoutTree(root);
    const measuredNodes = nodes.map((node) => ({
      ...node,
      ...measureNode(node),
    }));

    const minX = Math.min(...measuredNodes.map((node) => node.x - node.width / 2));
    const maxX = Math.max(...measuredNodes.map((node) => node.x + node.width / 2));
    const minY = Math.min(...measuredNodes.map((node) => node.y - node.height / 2));
    const maxY = Math.max(...measuredNodes.map((node) => node.y + node.height / 2));

    const sceneWidth = Math.ceil(maxX - minX + SCENE_PADDING * 2);
    const sceneHeight = Math.ceil(maxY - minY + SCENE_PADDING * 2);
    const offsetX = SCENE_PADDING - minX;
    const offsetY = SCENE_PADDING - minY;

    const renderNodes: RenderNode[] = measuredNodes.map((node) => ({
      ...node,
      renderX: node.x + offsetX,
      renderY: node.y + offsetY,
    }));

    const nodeById = new Map(renderNodes.map((node) => [node.id, node]));

    const renderEdges: RenderEdge[] = edges.flatMap((edge) => {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);

      if (!source || !target) {
        return [];
      }

      const start = getConnectorPoint(source, target.renderX, target.renderY);
      const end = getConnectorPoint(target, source.renderX, source.renderY);

      return [
        {
          id: edge.id,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          stroke: COLORS[edge.colorIndex % COLORS.length].bg,
          strokeWidth: Math.max(1.5, 3 - edge.depth * 0.5),
          opacity: 0.5,
        },
      ];
    });

    return { renderNodes, renderEdges, sceneWidth, sceneHeight };
  }, [root]);

  return (
    <div className="h-full w-full overflow-auto" style={{ background: "transparent" }}>
      <div className="flex min-h-full min-w-full items-center justify-center p-6">
        <div className="relative flex-none" style={{ width: sceneWidth, height: sceneHeight }}>
          <svg
            className="absolute inset-0 overflow-visible"
            width={sceneWidth}
            height={sceneHeight}
            viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
            aria-hidden="true"
          >
            {renderEdges.map((edge) => (
              <line
                key={edge.id}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={edge.stroke}
                strokeWidth={edge.strokeWidth}
                strokeOpacity={edge.opacity}
                strokeLinecap="round"
              />
            ))}
          </svg>

          {renderNodes.map((node) => (
            <MindMapCard key={node.id} node={node} />
          ))}
        </div>
      </div>
    </div>
  );
}
