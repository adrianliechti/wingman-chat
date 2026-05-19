/**
 * Self-contained SVG export for architecture diagrams.
 *
 * We don't use html2canvas: Tailwind v4 emits `oklch()` colour values which
 * html2canvas can't parse, and React Flow's CSS transform on the viewport
 * makes screenshot capture flaky regardless. Instead we walk the layout
 * positions and emit a fresh SVG that mirrors what `ArchitectureShapeNode`,
 * `ArchitectureGroupNode`, and `ArchitectureRelationEdge` render on screen.
 *
 * The PNG export rasterises this SVG via the browser's Canvas API.
 */

import type { ArchitectureDiagram, ArchitectureElementKind } from "../../types/notebook";
import { buildArchitectureFlow, type GraphFlowResult } from "./graphLayout";

interface ShapeStyle {
  bg: string;
  border: string;
  borderWidth: number;
  ink: string;
  rx: number;
  shape: "rect" | "circle" | "rounded";
}

const SHAPE_STYLES: Record<ArchitectureElementKind, ShapeStyle> = {
  person: { bg: "#fef3c7", border: "#b45309", borderWidth: 1.5, ink: "#0f172a", rx: 60, shape: "rounded" },
  actor: { bg: "#fef3c7", border: "#b45309", borderWidth: 1.5, ink: "#0f172a", rx: 60, shape: "rounded" },
  system: { bg: "#dbeafe", border: "#2563eb", borderWidth: 2, ink: "#0f172a", rx: 8, shape: "rect" },
  "external-system": { bg: "#f1f5f9", border: "#64748b", borderWidth: 1.5, ink: "#0f172a", rx: 8, shape: "rect" },
  container: { bg: "#ecfeff", border: "#0891b2", borderWidth: 1.5, ink: "#0f172a", rx: 8, shape: "rect" },
  component: { bg: "#f0f9ff", border: "#0284c7", borderWidth: 1.5, ink: "#0f172a", rx: 6, shape: "rect" },
  "deployment-node": { bg: "#f5f3ff", border: "#7c3aed", borderWidth: 1.5, ink: "#0f172a", rx: 4, shape: "rect" },
};

const ARROW_MARKER = `<marker id="ar-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1e293b"/></marker>`;
const ARROW_MARKER_INFERRED = `<marker id="ar-arrow-inferred" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker>`;

export function renderArchitectureSvg(_diagram: ArchitectureDiagram, flow: GraphFlowResult): string {
  const { width, height } = flow;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">`,
  );
  parts.push(`<defs>${ARROW_MARKER}${ARROW_MARKER_INFERRED}</defs>`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  // Groups first (low z) — dashed boundary boxes.
  for (const n of flow.nodes) {
    if (n.type !== "architectureGroup") continue;
    parts.push(renderGroup(n));
  }

  // Edges, with labels.
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
  for (const e of flow.edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) continue;
    parts.push(renderEdge(s, t, e));
  }

  // Shapes on top.
  for (const n of flow.nodes) {
    if (n.type !== "architectureShape") continue;
    parts.push(renderShape(n));
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function renderGroup(node: { position: { x: number; y: number }; data: unknown }): string {
  const d = node.data as {
    label: string;
    kind: string;
    technology?: string;
    width: number;
    height: number;
    inferred?: boolean;
  };
  const stroke = d.kind === "deployment-group" ? "#7c3aed" : "#3b82f6";
  const fill = d.kind === "deployment-group" ? "#f5f3ff66" : "#dbeafe33";
  const dash = d.inferred ? "2 3" : "5 3";
  const label = d.technology ? `${d.label} [${d.technology}]` : d.label;
  const labelW = Math.min(d.width - 28, label.length * 7 + 16);
  return [
    `<rect x="${node.position.x}" y="${node.position.y}" width="${d.width}" height="${d.height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="${dash}"/>`,
    `<rect x="${node.position.x + 14}" y="${node.position.y - 8}" width="${labelW}" height="14" fill="#ffffff"/>`,
    `<text x="${node.position.x + 22}" y="${node.position.y + 2}" fill="${stroke}" font-size="10" font-weight="700" letter-spacing="0.5" text-transform="uppercase">${escapeXml(label)}</text>`,
  ].join("");
}

function renderShape(node: { position: { x: number; y: number }; data: unknown }): string {
  const d = node.data as {
    elementKind: ArchitectureElementKind;
    label: string;
    technology?: string;
    description?: string;
    stereotype?: string;
    inferred: boolean;
    width: number;
    height: number;
  };
  const style = SHAPE_STYLES[d.elementKind] ?? SHAPE_STYLES.container;
  const x = node.position.x;
  const y = node.position.y;
  const w = d.width;
  const h = d.height;
  const dash = d.inferred ? `stroke-dasharray="6 4"` : "";

  const cx = x + w / 2;
  const cy = y + h / 2;

  const lines: string[] = [];
  lines.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${style.rx}" fill="${style.bg}" stroke="${style.border}" stroke-width="${style.borderWidth}" ${dash}/>`,
  );

  let textY = cy;
  if (d.stereotype) textY -= 16;
  else if (d.technology) textY -= 8;

  if (d.stereotype) {
    lines.push(
      `<text x="${cx}" y="${cy - 16}" fill="#64748b" font-size="9" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="0.3">${escapeXml(d.stereotype)}</text>`,
    );
  }
  lines.push(
    `<text x="${cx}" y="${textY}" fill="${style.ink}" font-size="13" font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeXml(trim(d.label, 28))}</text>`,
  );
  if (d.technology) {
    lines.push(
      `<text x="${cx}" y="${textY + 16}" fill="#64748b" font-size="10" font-weight="500" text-anchor="middle" dominant-baseline="central">[${escapeXml(trim(d.technology, 26))}]</text>`,
    );
  }
  if (d.inferred) {
    lines.push(
      `<text x="${x + w - 6}" y="${y + 10}" fill="#475569" font-size="8" font-weight="700" text-anchor="end" letter-spacing="0.4">INFERRED</text>`,
    );
  }
  return lines.join("");
}

function renderEdge(
  s: { position: { x: number; y: number }; data: unknown },
  t: { position: { x: number; y: number }; data: unknown },
  edge: { data?: unknown },
): string {
  const sd = s.data as { width: number; height: number };
  const td = t.data as { width: number; height: number };
  const sx = s.position.x + sd.width / 2;
  const sy = s.position.y + sd.height / 2;
  const tx = t.position.x + td.width / 2;
  const ty = t.position.y + td.height / 2;
  const ed = (edge.data ?? {}) as { label?: string; technology?: string; inferred?: boolean };
  const stroke = ed.inferred ? "#94a3b8" : "#1e293b";
  const dash = ed.inferred ? `stroke-dasharray="6 4"` : "";
  const marker = ed.inferred ? "ar-arrow-inferred" : "ar-arrow";

  // Trim line endpoints so the arrow head doesn't overlap the source/target shape.
  const angle = Math.atan2(ty - sy, tx - sx);
  const inset = 8;
  const sxAdj = sx + Math.cos(angle) * inset;
  const syAdj = sy + Math.sin(angle) * inset;
  const txAdj = tx - Math.cos(angle) * inset;
  const tyAdj = ty - Math.sin(angle) * inset;

  const parts: string[] = [
    `<line x1="${sxAdj}" y1="${syAdj}" x2="${txAdj}" y2="${tyAdj}" stroke="${stroke}" stroke-width="1.5" ${dash} marker-end="url(#${marker})"/>`,
  ];

  const labelText = ed.label && ed.technology ? `${ed.label} [${ed.technology}]` : (ed.label ?? ed.technology ?? "");
  if (labelText) {
    const mx = (sxAdj + txAdj) / 2;
    const my = (syAdj + tyAdj) / 2;
    const truncated = trim(labelText, 32);
    const labelW = Math.min(220, truncated.length * 6 + 12);
    parts.push(
      `<rect x="${mx - labelW / 2}" y="${my - 9}" width="${labelW}" height="18" rx="4" fill="#ffffff" stroke="#e2e8f0"/>`,
    );
    parts.push(
      `<text x="${mx}" y="${my}" fill="#334155" font-size="10" font-weight="500" text-anchor="middle" dominant-baseline="central">${escapeXml(truncated)}</text>`,
    );
  }

  return parts.join("");
}

// ── PNG rasterisation via the browser's Canvas API ─────────────────────

/**
 * Convert an SVG string to a PNG data URL by drawing it onto an offscreen
 * canvas. Uses a Blob URL + Image element — no external dependencies, no
 * dependency on html2canvas (which can't parse `oklch()` colours).
 */
export async function svgToPngDataUrl(svg: string, scale = 2): Promise<string> {
  // Pull dimensions from the SVG so we can size the canvas correctly.
  const wMatch = svg.match(/<svg[^>]*width="(\d+(?:\.\d+)?)"/);
  const hMatch = svg.match(/<svg[^>]*height="(\d+(?:\.\d+)?)"/);
  const width = wMatch ? Number(wMatch[1]) : 1200;
  const height = hMatch ? Number(hMatch[1]) : 800;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load SVG into Image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ── Sequence diagram (pure-function SVG, mirrors SequenceCanvas) ───────

const SEQ_HEADER_Y = 24;
const SEQ_HEADER_H = 56;
const SEQ_HEADER_W = 200;
const SEQ_COL_GAP = 60;
const SEQ_FIRST_MSG_Y = 110;
const SEQ_ROW_H = 64;
const SEQ_LEFT_PAD = 40;
const SEQ_RIGHT_PAD = 40;
const SEQ_BOTTOM_PAD = 60;

interface SeqParticipant {
  id: string;
  label: string;
  technology?: string;
  inferred: boolean;
}

interface SeqMessage {
  source: string;
  target: string;
  label?: string;
  technology?: string;
  kind?: string;
  inferred: boolean;
}

/** Layout helper shared with the on-screen `SequenceCanvas` component logic. */
function layoutSequence(diagram: ArchitectureDiagram): {
  width: number;
  height: number;
  participants: SeqParticipant[];
  lifelineX: Map<string, number>;
  messages: SeqMessage[];
} {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const elementIds = new Set(diagram.elements.map((e) => e.id));
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
  for (const e of diagram.elements) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      ordered.push(e.id);
    }
  }

  const elementById = new Map(diagram.elements.map((e) => [e.id, e]));
  const participants: SeqParticipant[] = ordered
    .map((id) => elementById.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({ id: e.id, label: e.label, technology: e.technology, inferred: e.inferred ?? false }));

  const lifelineX = new Map<string, number>();
  participants.forEach((p, i) => {
    lifelineX.set(p.id, SEQ_LEFT_PAD + SEQ_HEADER_W / 2 + i * (SEQ_HEADER_W + SEQ_COL_GAP));
  });

  const messages: SeqMessage[] = orderedRels
    .filter((r) => elementIds.has(r.source) && elementIds.has(r.target))
    .map((r) => ({
      source: r.source,
      target: r.target,
      label: r.label,
      technology: r.technology,
      kind: r.kind,
      inferred: r.inferred ?? false,
    }));

  const width = SEQ_LEFT_PAD + participants.length * (SEQ_HEADER_W + SEQ_COL_GAP) + SEQ_RIGHT_PAD;
  const height = SEQ_FIRST_MSG_Y + messages.length * SEQ_ROW_H + SEQ_BOTTOM_PAD;
  return { width, height, participants, lifelineX, messages };
}

export function renderSequenceSvg(diagram: ArchitectureDiagram): string {
  const { width, height, participants, lifelineX, messages } = layoutSequence(diagram);
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">`,
  );
  parts.push(
    `<defs><marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1e293b"/></marker><marker id="seq-arrow-inferred" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker><marker id="seq-arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#475569" stroke-width="1.5"/></marker></defs>`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  // Lifelines
  for (const p of participants) {
    const cx = lifelineX.get(p.id) ?? 0;
    parts.push(
      `<line x1="${cx}" y1="${SEQ_HEADER_Y + SEQ_HEADER_H}" x2="${cx}" y2="${height - SEQ_BOTTOM_PAD}" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
  }

  // Participant headers
  for (const p of participants) {
    const cx = lifelineX.get(p.id) ?? 0;
    const x = cx - SEQ_HEADER_W / 2;
    const dash = p.inferred ? 'stroke-dasharray="5 3"' : "";
    const fill = p.inferred ? "#fafaf9" : "#f1f5f9";
    const stroke = p.inferred ? "#94a3b8" : "#475569";
    parts.push(
      `<rect x="${x}" y="${SEQ_HEADER_Y}" width="${SEQ_HEADER_W}" height="${SEQ_HEADER_H}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${dash}/>`,
    );
    const ty = SEQ_HEADER_Y + SEQ_HEADER_H / 2 - (p.technology ? 6 : 0);
    parts.push(
      `<text x="${cx}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="13" font-weight="600">${escapeXml(trim(p.label, 22))}</text>`,
    );
    if (p.technology) {
      parts.push(
        `<text x="${cx}" y="${SEQ_HEADER_Y + SEQ_HEADER_H / 2 + 11}" text-anchor="middle" dominant-baseline="central" fill="#64748b" font-size="10" font-weight="500">[${escapeXml(trim(p.technology, 24))}]</text>`,
      );
    }
    if (p.inferred) {
      parts.push(
        `<text x="${x + SEQ_HEADER_W - 4}" y="${SEQ_HEADER_Y + 10}" text-anchor="end" fill="#64748b" font-size="9" font-weight="600" letter-spacing="0.3">INFERRED</text>`,
      );
    }
  }

  // Messages
  messages.forEach((m, i) => {
    const sx = lifelineX.get(m.source) ?? 0;
    const tx = lifelineX.get(m.target) ?? 0;
    const y = SEQ_FIRST_MSG_Y + i * SEQ_ROW_H;
    const marker = m.kind === "response" ? "seq-arrow-open" : m.inferred ? "seq-arrow-inferred" : "seq-arrow";
    const stroke = m.inferred ? "#94a3b8" : "#1e293b";
    const dash = m.inferred ? "6 4" : m.kind === "response" ? "3 3" : "";
    const dashAttr = dash ? `stroke-dasharray="${dash}"` : "";

    if (sx === tx) {
      const r = 24;
      parts.push(
        `<path d="M ${sx} ${y} h ${r} v ${r * 0.8} h -${r}" fill="none" stroke="${stroke}" stroke-width="1.5" ${dashAttr} marker-end="url(#${marker})"/>`,
      );
      const labelText = labelWithTech(m.label, m.technology);
      if (labelText) {
        parts.push(`<text x="${sx + r + 8}" y="${y + 6}" fill="#0f172a" font-size="11">${escapeXml(labelText)}</text>`);
      }
      return;
    }

    const dir = tx > sx ? 1 : -1;
    const startX = sx + dir * 4;
    const endX = tx - dir * 4;
    const midX = (startX + endX) / 2;
    parts.push(
      `<line x1="${startX}" y1="${y}" x2="${endX}" y2="${y}" stroke="${stroke}" stroke-width="1.5" ${dashAttr} marker-end="url(#${marker})"/>`,
    );
    const labelText = trim(labelWithTech(m.label, m.technology), 42);
    if (labelText) {
      const labelW = Math.min(280, labelText.length * 6.5 + 12);
      parts.push(
        `<rect x="${midX - labelW / 2}" y="${y - 22}" width="${labelW}" height="18" rx="3" fill="#ffffff" opacity="0.95"/>`,
      );
      parts.push(
        `<text x="${midX}" y="${y - 8}" text-anchor="middle" fill="${m.inferred ? "#475569" : "#0f172a"}" font-size="11" font-weight="500">${escapeXml(labelText)}</text>`,
      );
    }
    parts.push(
      `<text x="${startX + dir * 8}" y="${y - 4}" text-anchor="${dir > 0 ? "start" : "end"}" fill="#64748b" font-size="10" font-weight="600">${i + 1}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("");
}

function labelWithTech(label?: string, technology?: string): string {
  if (!label) return technology ? `[${technology}]` : "";
  if (!technology) return label;
  return `${label} [${technology}]`;
}

// ── Unified entry point ────────────────────────────────────────────────

const C4_VIEWS = ["c4-context", "c4-container", "c4-component", "deployment"] as const;
const C4_VIEW_LABEL: Record<(typeof C4_VIEWS)[number], string> = {
  "c4-context": "Context",
  "c4-container": "Container",
  "c4-component": "Component",
  deployment: "Deployment",
};

/**
 * Render an architecture diagram as a self-contained SVG string. No
 * DOM/viewer required — pure data → SVG. For `kind: "c4"` outputs the four
 * views are stacked vertically with section titles so a single export
 * carries everything the on-screen tabs show.
 */
export function renderArchitectureDiagramSvg(diagram: ArchitectureDiagram): string {
  if (diagram.kind === "sequence") return renderSequenceSvg(diagram);

  // c4 — stack all four views.
  const SECTION_GAP = 60;
  const TITLE_H = 36;
  const sections: { title: string; svg: string; width: number; height: number }[] = [];
  for (const view of C4_VIEWS) {
    const flow = buildArchitectureFlow(diagram, view);
    if (flow.nodes.length === 0) continue;
    sections.push({
      title: C4_VIEW_LABEL[view],
      svg: renderArchitectureSvg(diagram, flow),
      width: flow.width,
      height: flow.height,
    });
  }
  if (sections.length === 0) {
    // Fallback: render container view so an empty/incomplete diagram still produces something.
    const flow = buildArchitectureFlow(diagram, "c4-container");
    return renderArchitectureSvg(diagram, flow);
  }

  const totalWidth = Math.max(...sections.map((s) => s.width));
  const totalHeight =
    sections.reduce((sum, s) => sum + s.height + TITLE_H, 0) + (sections.length - 1) * SECTION_GAP + 20;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" font-family="system-ui, -apple-system, sans-serif">`,
    `<rect width="${totalWidth}" height="${totalHeight}" fill="#ffffff"/>`,
  ];
  let y = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    // Section title bar
    parts.push(
      `<text x="20" y="${y + 24}" fill="#475569" font-size="13" font-weight="700" letter-spacing="0.06em">${escapeXml(s.title.toUpperCase())}</text>`,
    );
    parts.push(`<line x1="20" y1="${y + 32}" x2="${totalWidth - 20}" y2="${y + 32}" stroke="#cbd5e1"/>`);
    // Embed the per-view SVG via nested <svg> at offset y + TITLE_H.
    parts.push(`<g transform="translate(0, ${y + TITLE_H})">${s.svg}</g>`);
    y += TITLE_H + s.height;
    if (i < sections.length - 1) y += SECTION_GAP;
  }
  parts.push(`</svg>`);
  return parts.join("");
}
