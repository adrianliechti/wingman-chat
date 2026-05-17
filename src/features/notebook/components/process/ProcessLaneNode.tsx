import type { NodeProps } from "@xyflow/react";

export interface ProcessLaneNodeData {
  label: string;
  width: number;
  height: number;
  /** Lane band background colour. Picked by the layout per process-style palette. */
  bg: string;
  [key: string]: unknown;
}

export function ProcessLaneNode({ data }: NodeProps) {
  const { label, width, height, bg } = data as unknown as ProcessLaneNodeData;
  return (
    <div
      style={{
        width,
        height,
        background: bg,
        borderTop: "1px solid #e5e7eb",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "stretch",
        position: "relative",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 140,
          background: "#ffffff",
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 12px",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#475569",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            textAlign: "center",
            lineHeight: 1.2,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
