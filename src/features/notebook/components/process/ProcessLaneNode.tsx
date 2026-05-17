import type { NodeProps } from "@xyflow/react";

export interface ProcessLaneNodeData {
  label: string;
  width: number;
  height: number;
  /** Alternating background tint index. */
  tint: 0 | 1;
  [key: string]: unknown;
}

const TINTS = ["#fafafa", "#f4f4f5"] as const;

export function ProcessLaneNode({ data }: NodeProps) {
  const { label, width, height, tint } = data as unknown as ProcessLaneNodeData;
  return (
    <div
      style={{
        width,
        height,
        background: TINTS[tint],
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
