/**
 * Dedicated SVG renderer for UML sequence diagrams.
 *
 * React Flow's free-form-node + 4-side-handle model doesn't fit sequence
 * diagrams cleanly — messages need to attach at arbitrary y-positions on
 * each lifeline. A small custom SVG component is dramatically simpler.
 *
 * The component renders headers for participants, vertical lifelines, and
 * horizontal arrows for messages ordered by `relation.order`.
 */

import { useMemo } from "react";
import type { ArchitectureDiagram } from "../../types/notebook";

interface SequenceCanvasProps {
  diagram: ArchitectureDiagram;
}

// Layout constants (px).
const HEADER_Y = 24;
const HEADER_H = 56;
const HEADER_W = 200;
const COL_GAP = 60;
const FIRST_MSG_Y = 110;
const ROW_H = 64;
const LEFT_PAD = 40;
const RIGHT_PAD = 40;
const BOTTOM_PAD = 60;

export function SequenceCanvas({ diagram }: SequenceCanvasProps) {
  const { width, height, participants, lifelineX, messages } = useMemo(() => layout(diagram), [diagram]);

  // Caller (ArchitectureViewer) provides the overflow-auto container; this
  // component just renders the canvas itself.
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", minWidth: "100%", minHeight: "100%" }}
      role="img"
      aria-label={`Sequence diagram: ${diagram.title}`}
    >
      <defs>
        <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#1e293b" />
        </marker>
        <marker
          id="seq-arrow-inferred"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
        </marker>
        <marker
          id="seq-arrow-open"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10" fill="none" stroke="#475569" strokeWidth="1.5" />
        </marker>
      </defs>

      {/* Lifelines */}
      {participants.map((p) => (
        <line
          key={`lifeline-${p.id}`}
          x1={lifelineX.get(p.id) ?? 0}
          y1={HEADER_Y + HEADER_H}
          x2={lifelineX.get(p.id) ?? 0}
          y2={height - BOTTOM_PAD}
          stroke="#cbd5e1"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      ))}

      {/* Participant headers */}
      {participants.map((p) => {
        const cx = lifelineX.get(p.id) ?? 0;
        const isInferred = p.inferred;
        return (
          <g key={`hdr-${p.id}`} transform={`translate(${cx - HEADER_W / 2}, ${HEADER_Y})`}>
            <rect
              width={HEADER_W}
              height={HEADER_H}
              rx={8}
              fill={isInferred ? "#fafaf9" : "#f1f5f9"}
              stroke={isInferred ? "#94a3b8" : "#475569"}
              strokeWidth={1.5}
              strokeDasharray={isInferred ? "5 3" : undefined}
            />
            <text
              x={HEADER_W / 2}
              y={HEADER_H / 2 - (p.technology ? 6 : 0)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fontWeight={600}
              fill="#0f172a"
            >
              {p.label}
            </text>
            {p.technology && (
              <text
                x={HEADER_W / 2}
                y={HEADER_H / 2 + 11}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fontWeight={500}
                fill="#64748b"
              >
                [{p.technology}]
              </text>
            )}
            {isInferred && (
              <text
                x={HEADER_W - 4}
                y={10}
                textAnchor="end"
                fontSize={9}
                fontWeight={600}
                fill="#64748b"
                letterSpacing={0.3}
              >
                INFERRED
              </text>
            )}
          </g>
        );
      })}

      {/* Messages */}
      {messages.map((m, i) => {
        const sx = lifelineX.get(m.source) ?? 0;
        const tx = lifelineX.get(m.target) ?? 0;
        const y = FIRST_MSG_Y + i * ROW_H;
        if (sx === tx) {
          // Self-call — render a small loop on the lifeline.
          const r = 24;
          return (
            <g key={m.id}>
              <path
                d={`M ${sx} ${y} h ${r} v ${r * 0.8} h -${r}`}
                fill="none"
                stroke={m.inferred ? "#94a3b8" : "#1e293b"}
                strokeWidth={1.5}
                strokeDasharray={m.inferred ? "5 3" : m.kind === "response" ? "3 3" : undefined}
                markerEnd={`url(#${m.kind === "response" ? "seq-arrow-open" : m.inferred ? "seq-arrow-inferred" : "seq-arrow"})`}
              />
              <text x={sx + r + 8} y={y + 6} fontSize={11} fill="#0f172a">
                {labelWithTech(m.label, m.technology)}
              </text>
            </g>
          );
        }
        const dir = tx > sx ? 1 : -1;
        const startX = sx + dir * 4;
        const endX = tx - dir * 4;
        const midX = (startX + endX) / 2;
        return (
          <g key={m.id}>
            <line
              x1={startX}
              y1={y}
              x2={endX}
              y2={y}
              stroke={m.inferred ? "#94a3b8" : "#1e293b"}
              strokeWidth={1.5}
              strokeDasharray={m.inferred ? "5 3" : m.kind === "response" ? "3 3" : undefined}
              markerEnd={`url(#${m.kind === "response" ? "seq-arrow-open" : m.inferred ? "seq-arrow-inferred" : "seq-arrow"})`}
            />
            <rect
              x={midX - Math.min(140, (m.label?.length ?? 8) * 4.2)}
              y={y - 22}
              width={Math.min(280, (m.label?.length ?? 8) * 8.4)}
              height={18}
              fill="white"
              opacity={0.95}
              rx={3}
            />
            <text
              x={midX}
              y={y - 8}
              textAnchor="middle"
              fontSize={11}
              fontWeight={500}
              fill={m.inferred ? "#475569" : "#0f172a"}
            >
              {trim(labelWithTech(m.label, m.technology), 42)}
            </text>
            <text
              x={startX + dir * 8}
              y={y - 4}
              textAnchor={dir > 0 ? "start" : "end"}
              fontSize={10}
              fontWeight={600}
              fill="#64748b"
            >
              {m.order}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────

interface LayoutParticipant {
  id: string;
  label: string;
  technology?: string;
  inferred: boolean;
}

interface LayoutMessage {
  id: string;
  source: string;
  target: string;
  label?: string;
  technology?: string;
  kind?: string;
  order: number;
  inferred: boolean;
}

interface LayoutResult {
  width: number;
  height: number;
  participants: LayoutParticipant[];
  lifelineX: Map<string, number>;
  messages: LayoutMessage[];
}

function layout(diagram: ArchitectureDiagram): LayoutResult {
  // Order participants by first appearance in relations (then declaration order).
  const ordered: string[] = [];
  const seen = new Set<string>();
  const elementIds = new Set(diagram.elements.map((e) => e.id));

  // Sort relations by order so the "first appearance" reflects sequence order.
  const orderedRels = [...diagram.relations].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  for (const r of orderedRels) {
    if (elementIds.has(r.source) && !seen.has(r.source)) {
      seen.add(r.source);
      ordered.push(r.source);
    }
    if (elementIds.has(r.target) && !seen.has(r.target)) {
      seen.add(r.target);
      ordered.push(r.target);
    }
  }
  // Pick up any leftover declared actors (unreferenced).
  for (const e of diagram.elements) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      ordered.push(e.id);
    }
  }

  const participantById = new Map<string, LayoutParticipant>();
  for (const e of diagram.elements) {
    participantById.set(e.id, {
      id: e.id,
      label: e.label,
      technology: e.technology,
      inferred: e.inferred ?? false,
    });
  }
  const participants: LayoutParticipant[] = ordered
    .map((id) => participantById.get(id))
    .filter((p): p is LayoutParticipant => p !== undefined);

  const lifelineX = new Map<string, number>();
  participants.forEach((p, i) => {
    lifelineX.set(p.id, LEFT_PAD + HEADER_W / 2 + i * (HEADER_W + COL_GAP));
  });

  // Build ordered message list. Pre-assign sequential indices since orders
  // can have gaps or duplicates from the model.
  const messages: LayoutMessage[] = orderedRels
    .filter((r) => elementIds.has(r.source) && elementIds.has(r.target))
    .map((r, idx) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      label: r.label,
      technology: r.technology,
      kind: r.kind,
      order: r.order ?? idx + 1,
      inferred: r.inferred ?? false,
    }));

  const width = LEFT_PAD + participants.length * (HEADER_W + COL_GAP) + RIGHT_PAD;
  const height = FIRST_MSG_Y + messages.length * ROW_H + BOTTOM_PAD;
  return { width, height, participants, lifelineX, messages };
}

function labelWithTech(label?: string, technology?: string): string {
  if (!label) return technology ? `[${technology}]` : "";
  if (!technology) return label;
  return `${label} [${technology}]`;
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
