import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from "@xyflow/react";

export interface ArchitectureRelationEdgeData {
  label?: string;
  technology?: string;
  kind?: "uses" | "includes" | "depends-on" | "message" | "response" | "fk-1-1" | "fk-1-n" | "fk-m-n";
  inferred: boolean;
  [key: string]: unknown;
}

function cardinality(kind: ArchitectureRelationEdgeData["kind"]): { source: string; target: string } | null {
  switch (kind) {
    case "fk-1-1":
      return { source: "1", target: "1" };
    case "fk-1-n":
      return { source: "1", target: "1..*" };
    case "fk-m-n":
      return { source: "*", target: "*" };
    default:
      return null;
  }
}

function dashFor(kind: ArchitectureRelationEdgeData["kind"], inferred: boolean): string | undefined {
  if (inferred) return "6 4";
  if (kind === "includes" || kind === "response") return "4 3";
  return undefined;
}

export function ArchitectureRelationEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const d = data as ArchitectureRelationEdgeData | undefined;
  const label = d?.label;
  const technology = d?.technology;
  const inferred = d?.inferred ?? false;
  const kind = d?.kind;
  const card = cardinality(kind);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const stroke = inferred ? "#94a3b8" : "#1e293b";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke, strokeWidth: 1.5, strokeDasharray: dashFor(kind, inferred), fill: "none" }}
        markerEnd={markerEnd}
      />
      {(label || technology) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: "white",
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${inferred ? "#cbd5e1" : "#e2e8f0"}`,
              fontSize: 10,
              color: inferred ? "#475569" : "#0f172a",
              pointerEvents: "all",
              whiteSpace: "nowrap",
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
            className="nodrag nopan"
          >
            <span style={{ fontWeight: 500 }}>{label}</span>
            {technology && (
              <span style={{ marginLeft: 6, color: "#64748b", fontWeight: 500, fontSize: 9 }}>[{technology}]</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
      {card && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${sourceX + (labelX - sourceX) * 0.2}px,${sourceY + (labelY - sourceY) * 0.2}px)`,
              background: "white",
              padding: "0 4px",
              fontSize: 10,
              fontWeight: 700,
              color: "#0f172a",
              border: "1px solid #e2e8f0",
              borderRadius: 3,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            {card.source}
          </div>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${targetX + (labelX - targetX) * 0.2}px,${targetY + (labelY - targetY) * 0.2}px)`,
              background: "white",
              padding: "0 4px",
              fontSize: 10,
              fontWeight: 700,
              color: "#0f172a",
              border: "1px solid #e2e8f0",
              borderRadius: 3,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            {card.target}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
