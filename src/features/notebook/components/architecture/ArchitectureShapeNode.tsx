import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { ArchitectureElementKind, ArchitectureView } from "../../types/notebook";

export interface ArchitectureShapeNodeData {
  elementKind: ArchitectureElementKind;
  /** Which view the node is currently being rendered in (drives any view-specific tweaks). */
  view: ArchitectureView;
  label: string;
  technology?: string;
  description?: string;
  stereotype?: string;
  inferred: boolean;
  width: number;
  height: number;
  [key: string]: unknown;
}

const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
  width: 1,
  height: 1,
  background: "transparent",
  border: "none",
};

interface SkinStyle {
  background: string;
  border: string;
  ink: string;
  techInk: string;
  borderWidth: number;
  borderStyle: "solid" | "dashed";
  borderRadius: number;
}

function skin(kind: ArchitectureElementKind, inferred: boolean): SkinStyle {
  const base: SkinStyle = {
    background: "#ffffff",
    border: "#475569",
    ink: "#0f172a",
    techInk: "#64748b",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderRadius: 8,
  };
  switch (kind) {
    case "person":
    case "actor":
      base.background = "#fef3c7";
      base.border = "#b45309";
      base.borderRadius = 60; // very round
      break;
    case "system":
      base.background = "#dbeafe";
      base.border = "#2563eb";
      base.borderWidth = 2;
      break;
    case "external-system":
      base.background = "#f1f5f9";
      base.border = "#64748b";
      break;
    case "container":
      base.background = "#ecfeff";
      base.border = "#0891b2";
      break;
    case "component":
      base.background = "#f0f9ff";
      base.border = "#0284c7";
      base.borderRadius = 6;
      break;
    case "deployment-node":
      base.background = "#f5f3ff";
      base.border = "#7c3aed";
      base.borderRadius = 4;
      break;
  }
  if (inferred) {
    base.borderStyle = "dashed";
  }
  return base;
}

export function ArchitectureShapeNode({ data }: NodeProps) {
  const { elementKind, label, technology, description, stereotype, inferred, width, height } =
    data as unknown as ArchitectureShapeNodeData;
  const style = skin(elementKind, inferred);

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        background: style.background,
        border: `${style.borderWidth}px ${style.borderStyle} ${style.border}`,
        borderRadius: style.borderRadius,
        color: style.ink,
        boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
      title={description ? `${description}${inferred ? "\n\n(inferred — refine to confirm)" : ""}` : undefined}
    >
      {/* Source + target handles per side — same scheme as ProcessShapeNode. */}
      <Handle type="target" position={Position.Left} id="left" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left} id="left-src" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Top} id="top" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Top} id="top-src" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id="right" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Right} id="right-tgt" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Bottom} id="bottom-tgt" style={HANDLE_STYLE} />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          padding: "8px 12px",
          textAlign: "center",
        }}
      >
        {stereotype && (
          <div style={{ fontSize: 9, fontWeight: 600, color: style.techInk, letterSpacing: 0.3 }}>{stereotype}</div>
        )}
        <div style={{ fontSize: 13, fontWeight: 600, color: style.ink, lineHeight: 1.2 }}>{label}</div>
        {technology && (
          <div style={{ fontSize: 10, fontWeight: 500, color: style.techInk, lineHeight: 1.2 }}>[{technology}]</div>
        )}
        {inferred && (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 6,
              fontSize: 8,
              fontWeight: 700,
              color: "#475569",
              letterSpacing: 0.4,
            }}
          >
            INFERRED
          </span>
        )}
      </div>
    </div>
  );
}
