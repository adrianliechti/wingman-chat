import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from "@xyflow/react";

export interface ProcessEdgeData {
  label?: string;
  flow?: "sequence" | "message";
  [key: string]: unknown;
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
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: "white",
              padding: "1px 6px",
              borderRadius: 4,
              border: "1px solid #e2e8f0",
              fontSize: 10,
              fontWeight: 500,
              color: "#334155",
              pointerEvents: "all",
              whiteSpace: "nowrap",
              maxWidth: 160,
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
