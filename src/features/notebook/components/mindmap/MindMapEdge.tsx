import { BaseEdge, getStraightPath, type EdgeProps } from "@xyflow/react";

export function MindMapCustomEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, data } = props;
  const colorIndex = (data as { colorIndex?: number })?.colorIndex ?? 0;
  const colors = (data as { colors?: { bg: string }[] })?.colors;
  const stroke = colors?.[colorIndex % colors.length]?.bg ?? "#999";

  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <BaseEdge
      path={edgePath}
      style={{ stroke, strokeWidth: 2, strokeOpacity: 0.5 }}
      {...props}
    />
  );
}
