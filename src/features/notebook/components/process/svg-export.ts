/**
 * Pure-function SVG renderer for a process diagram.
 *
 * Mirrors what `ProcessViewer` renders inside React Flow, but emits a string
 * directly from the layout result so exports work without the viewer being
 * mounted. Used by `StudioPanel`'s action-menu Download flow.
 */

import { escapeXml } from "../../lib/pptx-utils";
import type { ProcessDiagram } from "../../types/notebook";
import { buildProcessFlow } from "./layout";

export function renderProcessSvg(diagram: ProcessDiagram): string {
  const flow = buildProcessFlow({ diagram });
  const { nodes, edges, width, height } = flow;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  svg += `<defs><marker id="proc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1e293b"/></marker></defs>`;

  // Lane bands first (low z).
  for (const n of nodes) {
    if (n.type !== "processLane") continue;
    const d = n.data as { label: string; width: number; height: number; bg: string };
    svg += `<rect x="${n.position.x}" y="${n.position.y}" width="${d.width}" height="${d.height}" fill="${d.bg}" stroke="#e5e7eb"/>`;
    svg += `<rect x="${n.position.x}" y="${n.position.y}" width="140" height="${d.height}" fill="#ffffff" stroke="#e5e7eb"/>`;
    svg += `<text x="${n.position.x + 70}" y="${n.position.y + d.height / 2}" text-anchor="middle" dominant-baseline="central" fill="#475569" font-size="11" font-weight="600" letter-spacing="0.5">${escapeXml(d.label.toUpperCase())}</text>`;
  }

  // Edges (straight centre-to-centre — good enough for an export snapshot).
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) continue;
    const sd = s.data as { width?: number; height?: number };
    const td = t.data as { width?: number; height?: number };
    const sw = sd.width ?? 160;
    const sh = sd.height ?? 64;
    const tw = td.width ?? 160;
    const th = td.height ?? 64;
    const sx = s.position.x + sw / 2;
    const sy = s.position.y + sh / 2;
    const tx = t.position.x + tw / 2;
    const ty = t.position.y + th / 2;
    const ed = (e.data ?? {}) as { label?: string; flow?: "sequence" | "message" };
    const isMessage = ed.flow === "message";
    svg += `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="#1e293b" stroke-width="1.5" ${isMessage ? 'stroke-dasharray="6 4"' : ""} marker-end="url(#proc-arrow)"/>`;
    if (ed.label) {
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const labelW = Math.min(160, ed.label.length * 6.5 + 12);
      svg += `<rect x="${mx - labelW / 2}" y="${my - 9}" width="${labelW}" height="18" rx="4" fill="#ffffff" stroke="#e2e8f0"/>`;
      svg += `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" fill="#334155" font-size="10" font-weight="500">${escapeXml(trim(ed.label, 28))}</text>`;
    }
  }

  // Shapes on top.
  for (const n of nodes) {
    if (n.type !== "processShape") continue;
    const d = n.data as {
      label: string;
      kind: "start" | "end" | "task" | "subprocess" | "decision" | "parallel" | "event" | "data";
      description?: string;
      control?: string;
      width: number;
      height: number;
    };
    const cx = n.position.x + d.width / 2;
    const cy = n.position.y + d.height / 2;
    const r = Math.min(d.width, d.height) / 2;

    if (d.kind === "decision" || d.kind === "parallel") {
      const fill = d.kind === "decision" ? "#fef9c3" : "#e0e7ff";
      const stroke = d.kind === "decision" ? "#ca8a04" : "#4f46e5";
      svg += `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#1e293b" font-size="${d.kind === "parallel" ? 20 : 10}" font-weight="600">${escapeXml(d.kind === "parallel" ? "+" : trim(d.label, 18))}</text>`;
    } else if (d.kind === "start" || d.kind === "end" || d.kind === "event") {
      const fill = d.kind === "start" ? "#dcfce7" : d.kind === "end" ? "#fee2e2" : "#fef3c7";
      const stroke = d.kind === "start" ? "#16a34a" : d.kind === "end" ? "#dc2626" : "#d97706";
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${d.kind === "end" ? 3 : 2}"/>`;
      if (d.kind === "event") {
        svg += `<circle cx="${cx}" cy="${cy}" r="${r - 4}" fill="none" stroke="${stroke}" stroke-width="2"/>`;
      }
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#1e293b" font-size="10" font-weight="500">${escapeXml(trim(d.label, 16))}</text>`;
    } else {
      const rx = d.kind === "subprocess" ? 4 : d.kind === "data" ? 14 : 8;
      svg += `<rect x="${n.position.x}" y="${n.position.y}" width="${d.width}" height="${d.height}" rx="${rx}" fill="${d.kind === "data" ? "#f1f5f9" : "#ffffff"}" stroke="${d.kind === "subprocess" ? "#1e293b" : "#475569"}" stroke-width="${d.kind === "subprocess" ? 2 : 1.5}"/>`;
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="11" font-weight="${d.kind === "subprocess" ? 600 : 500}">${escapeXml(trim(d.label, 28))}</text>`;
      if (d.control) {
        const chipW = Math.max(20, d.control.length * 5);
        svg += `<rect x="${n.position.x + d.width - 8}" y="${n.position.y - 6}" width="${chipW}" height="14" rx="6" fill="#1e293b"/>`;
        svg += `<text x="${n.position.x + d.width - 8 + chipW / 2}" y="${n.position.y + 1}" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-size="9" font-weight="600">${escapeXml(d.control)}</text>`;
      }
    }
  }

  svg += `</svg>`;
  return svg;
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
