import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { ArchitectureElementKind, ArchitectureField, ArchitectureKind } from "../../types/notebook";

export interface ArchitectureShapeNodeData {
  elementKind: ArchitectureElementKind;
  diagramKind: ArchitectureKind;
  label: string;
  technology?: string;
  description?: string;
  stereotype?: string;
  fields?: ArchitectureField[];
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
    case "entity":
      base.background = "#ffffff";
      base.border = "#0f172a";
      base.borderWidth = 1.5;
      base.borderRadius = 6;
      break;
  }
  if (inferred) {
    base.borderStyle = "dashed";
  }
  return base;
}

export function ArchitectureShapeNode({ data }: NodeProps) {
  const { elementKind, label, technology, description, stereotype, fields, inferred, width, height } =
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

      {elementKind === "entity" ? (
        <EntityBody label={label} fields={fields} inferred={inferred} />
      ) : (
        <BoxBody
          label={label}
          technology={technology}
          stereotype={stereotype}
          ink={style.ink}
          techInk={style.techInk}
          inferred={inferred}
        />
      )}
    </div>
  );
}

function BoxBody({
  label,
  technology,
  stereotype,
  ink,
  techInk,
  inferred,
}: {
  label: string;
  technology?: string;
  stereotype?: string;
  ink: string;
  techInk: string;
  inferred: boolean;
}) {
  return (
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
        <div style={{ fontSize: 9, fontWeight: 600, color: techInk, letterSpacing: 0.3 }}>{stereotype}</div>
      )}
      <div style={{ fontSize: 13, fontWeight: 600, color: ink, lineHeight: 1.2 }}>{label}</div>
      {technology && (
        <div style={{ fontSize: 10, fontWeight: 500, color: techInk, lineHeight: 1.2 }}>[{technology}]</div>
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
  );
}

function EntityBody({ label, fields, inferred }: { label: string; fields?: ArchitectureField[]; inferred: boolean }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "8px 10px",
          background: inferred ? "#fafaf9" : "#0f172a",
          color: inferred ? "#1e293b" : "white",
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: 0.2,
          borderBottom: "1px solid #cbd5e1",
        }}
      >
        {label}
        {inferred && (
          <span
            style={{
              float: "right",
              fontSize: 8,
              fontWeight: 700,
              color: "#475569",
              letterSpacing: 0.4,
              marginTop: 2,
            }}
          >
            INFERRED
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {fields?.map((f) => (
          <div
            key={`${f.name}:${f.type ?? ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "3px 10px",
              fontSize: 10.5,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              borderBottom: "1px solid #f1f5f9",
              gap: 6,
            }}
          >
            <span style={{ flex: 1, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {f.name}
            </span>
            {f.type && <span style={{ color: "#64748b" }}>{f.type}</span>}
            {f.notation && (
              <span
                style={{
                  background: f.notation.includes("PK") ? "#fde68a" : f.notation.includes("FK") ? "#bae6fd" : "#e2e8f0",
                  color: "#0f172a",
                  fontSize: 8,
                  fontWeight: 700,
                  padding: "0 4px",
                  borderRadius: 3,
                  letterSpacing: 0.3,
                }}
              >
                {f.notation}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
