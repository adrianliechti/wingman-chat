import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from "@xyflow/react";

export interface ProcessEdgeData {
  label?: string;
  flow?: "sequence" | "message";
  [key: string]: unknown;
}

/** Tiny hash → small vertical jitter so two near-parallel edge labels don't
 *  land at the exact same midpoint. Range: roughly ±24 px. */
function labelYStagger(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 5) - 2) * 12;
}

export function ProcessCustomEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const flow = (data as ProcessEdgeData | undefined)?.flow ?? "sequence";
  const label = (data as ProcessEdgeData | undefined)?.label;

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

  const isMessage = flow === "message";
  const style: React.CSSProperties = {
    stroke: isMessage ? "#64748b" : "#1e293b",
    strokeWidth: 1.5,
    strokeDasharray: isMessage ? "6 4" : undefined,
    fill: "none",
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelYAdj}px)`,
              background: "white",
              padding: "1px 6px",
              borderRadius: 4,
              border: "1px solid #e2e8f0",
              fontSize: 10,
              fontWeight: 500,
              color: "#334155",
              pointerEvents: "all",
              whiteSpace: "nowrap",
              maxWidth: 150,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
