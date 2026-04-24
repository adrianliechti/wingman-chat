import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface MindMapNodeData {
  label: string;
  depth: number;
  colorIndex: number;
  colors: { bg: string; light: string; border: string; text: string }[];
  [key: string]: unknown;
}

export function MindMapCustomNode({ data }: NodeProps) {
  const { label, depth, colorIndex, colors } = data as unknown as MindMapNodeData;
  const color = colors[colorIndex % colors.length];
  const isRoot = depth === 0;
  const isMajor = depth === 1;

  const fontSize = isRoot ? 16 : isMajor ? 13 : 12;
  const fontWeight = isRoot ? 700 : isMajor ? 600 : 500;
  const px = isRoot ? 20 : isMajor ? 16 : 12;
  const py = isRoot ? 14 : isMajor ? 10 : 8;

  const style: React.CSSProperties = {
    fontSize,
    fontWeight,
    padding: `${py}px ${px}px`,
    whiteSpace: "nowrap",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  if (isRoot) {
    Object.assign(style, {
      background: "#262626",
      color: "#fff",
      borderRadius: 16,
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    });
  } else if (isMajor) {
    Object.assign(style, {
      background: color.bg,
      color: "#fff",
      borderRadius: 12,
      boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
    });
  } else {
    Object.assign(style, {
      background: color.light,
      color: color.text,
      border: `1.5px solid ${color.border}`,
      borderRadius: 10,
    });
  }

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <div style={style}>{label}</div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
    </>
  );
}
