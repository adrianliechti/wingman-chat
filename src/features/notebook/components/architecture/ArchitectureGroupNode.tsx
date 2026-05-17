import type { NodeProps } from "@xyflow/react";

export interface ArchitectureGroupNodeData {
  label: string;
  kind: "system-boundary" | "deployment-group";
  technology?: string;
  width: number;
  height: number;
  inferred?: boolean;
  [key: string]: unknown;
}

export function ArchitectureGroupNode({ data }: NodeProps) {
  const { label, kind, technology, width, height, inferred } = data as unknown as ArchitectureGroupNodeData;
  const isBoundary = kind === "system-boundary";

  return (
    <div
      style={{
        width,
        height,
        background: isBoundary ? "rgba(219,234,254,0.20)" : "rgba(245,243,255,0.45)",
        border: `${isBoundary ? 1.5 : 1.5}px ${inferred ? "dotted" : "dashed"} ${isBoundary ? "#3b82f6" : "#7c3aed"}`,
        borderRadius: 12,
        position: "relative",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -10,
          left: 14,
          background: "white",
          padding: "0 8px",
          fontSize: 10,
          fontWeight: 700,
          color: isBoundary ? "#1d4ed8" : "#6d28d9",
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {label}
        {technology && (
          <span style={{ marginLeft: 6, color: "#64748b", fontWeight: 500, textTransform: "none" }}>
            [{technology}]
          </span>
        )}
      </div>
    </div>
  );
}
