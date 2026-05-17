import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from "@xyflow/react";

export interface ArchitectureRelationEdgeData {
  label?: string;
  technology?: string;
  kind?: "uses" | "includes" | "depends-on" | "message" | "response";
  inferred: boolean;
  [key: string]: unknown;
}

function dashFor(kind: ArchitectureRelationEdgeData["kind"], inferred: boolean): string | undefined {
  if (inferred) return "6 4";
  if (kind === "includes" || kind === "response") return "4 3";
  return undefined;
}

/** Tiny hash → small vertical jitter so two near-parallel edge labels don't
 *  land at the exact same midpoint. Range: roughly ±24 px. */
function labelYStagger(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 5) - 2) * 12;
}

export function ArchitectureRelationEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const d = data as ArchitectureRelationEdgeData | undefined;
  const label = d?.label;
  const technology = d?.technology;
  const inferred = d?.inferred ?? false;
  const kind = d?.kind;

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
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelYAdj}px)`,
              background: "white",
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${inferred ? "#cbd5e1" : "#e2e8f0"}`,
              fontSize: 10,
              color: inferred ? "#475569" : "#0f172a",
              pointerEvents: "all",
              whiteSpace: "nowrap",
              maxWidth: 150,
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
    </>
  );
}
