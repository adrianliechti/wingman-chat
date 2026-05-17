import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { ProcessNodeKind } from "../../types/notebook";

export interface ProcessShapeNodeData {
  label: string;
  kind: ProcessNodeKind;
  description?: string;
  control?: string;
  /** Width of the rendered shape (derived during layout). */
  width: number;
  /** Height of the rendered shape (derived during layout). */
  height: number;
  [key: string]: unknown;
}

interface NodeStyle {
  /** Background fill colour. */
  background: string;
  /** Border / stroke colour. */
  border: string;
  /** Border thickness in px. */
  borderWidth: number;
  /** Text colour. */
  ink: string;
  /** Font weight for the label. */
  weight: number;
  /** Optional second inner ring (for `event` double-line circles). */
  innerRing?: boolean;
  /** Render shape as a diamond rotated 45°. */
  diamond?: boolean;
  /** Render shape as a circle. */
  circle?: boolean;
  /** Render as a data-store cylinder. */
  cylinder?: boolean;
}

const KIND_STYLE: Record<ProcessNodeKind, NodeStyle> = {
  start: {
    background: "#dcfce7",
    border: "#16a34a",
    borderWidth: 2,
    ink: "#14532d",
    weight: 600,
    circle: true,
  },
  end: {
    background: "#fee2e2",
    border: "#dc2626",
    borderWidth: 3,
    ink: "#7f1d1d",
    weight: 600,
    circle: true,
  },
  event: {
    background: "#fef3c7",
    border: "#d97706",
    borderWidth: 2,
    ink: "#78350f",
    weight: 500,
    circle: true,
    innerRing: true,
  },
  task: {
    background: "#ffffff",
    border: "#475569",
    borderWidth: 1.5,
    ink: "#0f172a",
    weight: 500,
  },
  subprocess: {
    background: "#f8fafc",
    border: "#1e293b",
    borderWidth: 2,
    ink: "#0f172a",
    weight: 600,
  },
  decision: {
    background: "#fef9c3",
    border: "#ca8a04",
    borderWidth: 2,
    ink: "#713f12",
    weight: 600,
    diamond: true,
  },
  parallel: {
    background: "#e0e7ff",
    border: "#4f46e5",
    borderWidth: 2,
    ink: "#1e1b4b",
    weight: 700,
    diamond: true,
  },
  data: {
    background: "#f1f5f9",
    border: "#64748b",
    borderWidth: 1.5,
    ink: "#1e293b",
    weight: 500,
    cylinder: true,
  },
};

const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
  width: 1,
  height: 1,
  background: "transparent",
  border: "none",
};

export function ProcessShapeNode({ data }: NodeProps) {
  const { label, kind, description, control, width, height } = data as unknown as ProcessShapeNodeData;
  const style = KIND_STYLE[kind] ?? KIND_STYLE.task;

  const baseShape: React.CSSProperties = {
    width,
    height,
    background: style.background,
    border: `${style.borderWidth}px solid ${style.border}`,
    color: style.ink,
    fontWeight: style.weight,
    fontSize: 12,
    lineHeight: 1.25,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "4px 8px",
    boxSizing: "border-box",
    boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
    position: "relative",
    whiteSpace: "normal",
    overflow: "hidden",
  };

  let content: React.ReactNode;

  if (style.diamond) {
    // Diamond: rotate a square 45°, counter-rotate the inner text.
    const side = Math.min(width, height);
    content = (
      <div
        style={{
          width: side,
          height: side,
          background: style.background,
          border: `${style.borderWidth}px solid ${style.border}`,
          transform: "rotate(45deg)",
          boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            transform: "rotate(-45deg)",
            color: style.ink,
            fontWeight: style.weight,
            fontSize: kind === "parallel" ? 20 : 11,
            lineHeight: 1.2,
            textAlign: "center",
            padding: "0 4px",
            maxWidth: side * 0.85,
          }}
        >
          {kind === "parallel" ? "+" : label}
        </div>
      </div>
    );
  } else if (style.circle) {
    const side = Math.min(width, height);
    content = (
      <div
        style={{
          width: side,
          height: side,
          borderRadius: "50%",
          background: style.background,
          border: `${style.borderWidth}px solid ${style.border}`,
          boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {style.innerRing && (
          <div
            style={{
              position: "absolute",
              inset: 3,
              borderRadius: "50%",
              border: `${style.borderWidth}px solid ${style.border}`,
            }}
          />
        )}
        <div
          style={{
            color: style.ink,
            fontWeight: style.weight,
            fontSize: 10,
            textAlign: "center",
            padding: "0 6px",
            maxWidth: side * 0.85,
            lineHeight: 1.1,
          }}
        >
          {label}
        </div>
      </div>
    );
  } else if (style.cylinder) {
    content = (
      <div style={{ ...baseShape, borderRadius: 14, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: -1,
            left: -1,
            right: -1,
            height: 10,
            border: `${style.borderWidth}px solid ${style.border}`,
            borderBottom: "none",
            borderRadius: "14px 14px 0 0",
            background: style.background,
          }}
        />
        <span style={{ marginTop: 4 }}>{label}</span>
      </div>
    );
  } else {
    content = (
      <div style={{ ...baseShape, borderRadius: kind === "subprocess" ? 4 : 8 }}>
        <span>{label}</span>
      </div>
    );
  }

  const tooltipLines = [description, control && `Control: ${control}`].filter(Boolean);
  const title = tooltipLines.length > 0 ? tooltipLines.join("\n") : undefined;

  return (
    <div style={{ position: "relative", width, height }} title={title}>
      {/* Hidden handles on all 4 sides so the layout can pick the best one. */}
      <Handle type="target" position={Position.Left} id="left" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Top} id="top" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id="right" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      {content}
      {control && !style.diamond && !style.circle && (
        <span
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            background: "#1e293b",
            color: "white",
            fontSize: 9,
            fontWeight: 600,
            padding: "1px 5px",
            borderRadius: 6,
            letterSpacing: 0.2,
            boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
          }}
        >
          {control}
        </span>
      )}
    </div>
  );
}
