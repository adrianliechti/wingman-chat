/**
 * PDF "audit pack" export for a data catalog.
 *
 * Renders the catalog as a self-contained, paginated A4 PDF: cover →
 * inventory tables → inline lineage SVG → glossary cards → contract cards.
 * The audience is governance / BCBS-239 review committees who consume PDFs.
 *
 * Pipeline:
 *   1. `renderDataCatalogHtml(catalog)` builds a stand-alone HTML document
 *      with **inline hex colours only** (Tailwind v4's `oklch()` breaks
 *      html2canvas; the same rule we apply to the SVG exporters).
 *   2. The HTML is loaded into a hidden iframe.
 *   3. html2canvas rasterises the iframe body.
 *   4. jsPDF lays the rasterised image across A4 pages.
 *
 * Returns a `data:application/pdf;base64,…` URL so it slots into the same
 * download pipeline used by SVG / PNG.
 */

import type { DataCatalog, Dataset, DataContract, GlossaryTerm, LineageEdge, LineageNode } from "../types/notebook";

// ── HTML template ─────────────────────────────────────────────────────

const SENSITIVITY_PILL: Record<string, { bg: string; fg: string }> = {
  public: { bg: "#dcfce7", fg: "#166534" },
  internal: { bg: "#dbeafe", fg: "#1e40af" },
  confidential: { bg: "#fef3c7", fg: "#92400e" },
  restricted: { bg: "#fee2e2", fg: "#991b1b" },
};

const KIND_LABEL: Record<string, string> = {
  inventory: "Inventory · DCAT 3",
  glossary: "Glossary · SKOS / FIBO",
  lineage: "Lineage · OpenLineage",
  contracts: "Contracts · ODCS",
};

export function renderDataCatalogHtml(catalog: DataCatalog): string {
  const inferredCount =
    catalog.datasets.filter((d) => d.inferred).length +
    catalog.glossary.filter((t) => t.inferred).length +
    catalog.lineageNodes.filter((n) => n.inferred).length +
    catalog.contracts.filter((c) => c.inferred).length;

  const generatedAt = new Date().toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(catalog.title)} — Data Catalog</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a; background: #ffffff; margin: 0; padding: 36px 40px;
    font-size: 12px; line-height: 1.45;
  }
  h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; color: #0f172a; letter-spacing: -0.01em; }
  h2 {
    font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
    color: #475569; margin: 28px 0 10px; padding-bottom: 4px;
    border-bottom: 1px solid #cbd5e1;
  }
  h3 { font-size: 12px; font-weight: 700; margin: 16px 0 6px; color: #0f172a; }
  p { margin: 0 0 6px; }
  .cover { padding-bottom: 16px; border-bottom: 2px solid #0f172a; margin-bottom: 8px; }
  .meta { color: #64748b; font-size: 10px; margin-top: 4px; }
  .summary { margin-top: 10px; color: #334155; max-width: 640px; }
  .stats { display: flex; gap: 24px; margin-top: 16px; flex-wrap: wrap; }
  .stat { font-size: 10px; color: #64748b; }
  .stat strong { font-size: 18px; font-weight: 800; color: #0f172a; display: block; line-height: 1.1; }
  .banner-inferred {
    margin-top: 14px; padding: 8px 12px; border: 1px solid #fcd34d; background: #fffbeb;
    border-radius: 4px; color: #92400e; font-size: 10px;
  }
  .banner-inferred strong { color: #78350f; }
  .domain { margin-top: 14px; }
  .domain-name { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 5px 8px; vertical-align: top; }
  th {
    background: #f1f5f9; text-align: left; font-weight: 700; font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.05em; color: #475569;
    border-bottom: 1px solid #cbd5e1;
  }
  td { border-bottom: 1px solid #f1f5f9; font-size: 10px; }
  tr:nth-child(even) td { background: #fafafa; }
  .ds-name { font-weight: 700; color: #0f172a; }
  .ds-fqn { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 9px; color: #64748b; }
  .pill {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    font-size: 9px; font-weight: 700; letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .pill-inferred { background: #e2e8f0; color: #475569; }
  .tag {
    display: inline-block; padding: 1px 5px; margin: 1px 2px 1px 0;
    background: #f1f5f9; color: #475569; font-size: 8px;
    border-radius: 2px; font-weight: 600;
  }
  .card {
    border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;
    margin-bottom: 8px; background: #ffffff; page-break-inside: avoid;
  }
  .card.inferred { border-style: dashed; background: #fafafa; }
  .card-title {
    font-size: 13px; font-weight: 700; margin: 0;
    color: #0f172a; display: flex; align-items: baseline; gap: 8px;
  }
  .card-version {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 9px; font-weight: 600; color: #475569;
    background: #f1f5f9; padding: 1px 4px; border-radius: 2px;
  }
  .card-meta { font-size: 9px; color: #64748b; margin-top: 2px; margin-bottom: 8px; }
  .card-section { margin-top: 8px; }
  .card-section-label {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #64748b; margin-bottom: 3px;
  }
  ul { margin: 0; padding-left: 18px; font-size: 10px; }
  li { margin-bottom: 2px; }
  dl { margin: 0; }
  dt { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; margin-top: 5px; }
  dd { margin: 0 0 4px; font-size: 10px; color: #0f172a; }
  .term-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .term {
    border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;
    page-break-inside: avoid; background: #ffffff;
  }
  .term.inferred { border-style: dashed; background: #fafafa; }
  .term-name { font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
  .term-defn { font-size: 10px; color: #334155; margin-bottom: 6px; }
  .term-meta { font-size: 9px; color: #64748b; margin-bottom: 2px; }
  .term-meta a { color: #2563eb; text-decoration: none; word-break: break-all; }
  .lineage-table th, .lineage-table td { font-size: 9px; }
  .lineage-svg { margin: 8px 0 16px; }
  .lineage-svg svg { max-width: 100%; height: auto; display: block; border: 1px solid #e2e8f0; border-radius: 4px; background: #ffffff; }
  .empty { font-size: 10px; color: #94a3b8; font-style: italic; margin: 12px 0; }
</style>
</head>
<body>

<section class="cover">
  <h1>${escapeHtml(catalog.title)}</h1>
  <p class="meta">Data Catalog · ${escapeHtml(KIND_LABEL[catalog.kind] ?? catalog.kind)} · Generated ${escapeHtml(generatedAt)}</p>
  ${catalog.summary ? `<p class="summary">${escapeHtml(catalog.summary)}</p>` : ""}
  <div class="stats">
    <div class="stat"><strong>${catalog.datasets.length}</strong>datasets</div>
    <div class="stat"><strong>${catalog.glossary.length}</strong>glossary terms</div>
    <div class="stat"><strong>${catalog.lineageNodes.length}</strong>lineage nodes</div>
    <div class="stat"><strong>${catalog.contracts.length}</strong>contracts</div>
  </div>
  ${
    inferredCount > 0
      ? `<div class="banner-inferred"><strong>${inferredCount} item${inferredCount === 1 ? "" : "s"} marked INFERRED</strong> — synthesised by Wingman because the source material did not explicitly name them. Review before relying on for compliance.</div>`
      : ""
  }
</section>

${renderInventorySection(catalog.datasets)}
${renderLineageSection(catalog)}
${renderGlossarySection(catalog.glossary, catalog.datasets)}
${renderContractsSection(catalog.contracts, catalog.datasets)}

</body>
</html>`;
}

// ── Sections ──────────────────────────────────────────────────────────

function renderInventorySection(datasets: Dataset[]): string {
  if (datasets.length === 0) return "";
  const byDomain = new Map<string, Dataset[]>();
  for (const d of datasets) {
    const key = d.domain ?? "Other";
    const arr = byDomain.get(key) ?? [];
    arr.push(d);
    byDomain.set(key, arr);
  }

  const blocks: string[] = ['<section><h2>Inventory</h2>'];
  for (const [domain, dsList] of byDomain) {
    blocks.push(`<div class="domain">`);
    blocks.push(`<div class="domain-name">${escapeHtml(domain)} <span style="font-weight:400;opacity:0.6">· ${dsList.length}</span></div>`);
    blocks.push('<table><thead><tr>');
    blocks.push(
      '<th style="width:30%">Dataset</th><th style="width:14%">System</th><th style="width:18%">Owner</th><th style="width:10%">Refresh</th><th style="width:12%">Sensitivity</th><th>Tags</th>',
    );
    blocks.push('</tr></thead><tbody>');
    for (const d of dsList) {
      blocks.push("<tr>");
      blocks.push(
        `<td><div class="ds-name">${escapeHtml(d.title)}${d.inferred ? ' <span class="pill pill-inferred">Inferred</span>' : ""}</div><div class="ds-fqn">${escapeHtml(d.name)}</div></td>`,
      );
      blocks.push(`<td>${escapeHtml(d.system ?? "—")}</td>`);
      blocks.push(`<td>${escapeHtml(d.owner ?? "—")}${d.steward ? `<br/><span style="font-size:8px;color:#94a3b8">${escapeHtml(d.steward)}</span>` : ""}</td>`);
      blocks.push(`<td>${escapeHtml(d.refreshCadence ?? "—")}</td>`);
      blocks.push(`<td>${renderSensitivityPill(d.sensitivity)}</td>`);
      blocks.push(`<td>${(d.regulatoryTags ?? []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</td>`);
      blocks.push("</tr>");
    }
    blocks.push("</tbody></table></div>");
  }
  blocks.push("</section>");
  return blocks.join("");
}

function renderSensitivityPill(s: string | undefined): string {
  if (!s) return "—";
  const tint = SENSITIVITY_PILL[s] ?? { bg: "#e2e8f0", fg: "#475569" };
  return `<span class="pill" style="background:${tint.bg};color:${tint.fg}">${escapeHtml(s)}</span>`;
}

function renderLineageSection(catalog: DataCatalog): string {
  if (catalog.lineageNodes.length === 0) return "";
  const svg = renderLineageSvg(catalog);
  const jobs = catalog.lineageNodes.filter((n) => n.kind === "job");
  return `<section>
<h2>Lineage</h2>
${svg ? `<div class="lineage-svg">${svg}</div>` : ""}
${
  jobs.length > 0
    ? `<table class="lineage-table"><thead><tr><th style="width:30%">Job</th><th style="width:12%">Tech</th><th style="width:28%">Inputs</th><th>Outputs</th></tr></thead><tbody>${jobs
        .map((job) => {
          const inputs = catalog.lineageEdges
            .filter((e) => e.target === job.id)
            .map((e) => catalog.lineageNodes.find((n) => n.id === e.source)?.label ?? e.source);
          const outputs = catalog.lineageEdges
            .filter((e) => e.source === job.id)
            .map((e) => catalog.lineageNodes.find((n) => n.id === e.target)?.label ?? e.target);
          return `<tr><td><div class="ds-name">${escapeHtml(job.label)}${job.inferred ? ' <span class="pill pill-inferred">Inferred</span>' : ""}</div></td><td>${escapeHtml(job.technology ?? "—")}</td><td>${inputs.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join("")}</td><td>${outputs.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join("")}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : ""
}
</section>`;
}

function renderGlossarySection(terms: GlossaryTerm[], datasets: Dataset[]): string {
  if (terms.length === 0) return "";
  const dsTitleById = new Map(datasets.map((d) => [d.id, d.title]));
  const sorted = [...terms].sort((a, b) => a.term.localeCompare(b.term));
  return `<section>
<h2>Glossary</h2>
<div class="term-grid">
${sorted
  .map(
    (t) => `<div class="term${t.inferred ? " inferred" : ""}">
  <div class="term-name">${escapeHtml(t.term)}${t.inferred ? ' <span class="pill pill-inferred">Inferred</span>' : ""}</div>
  <div class="term-defn">${escapeHtml(t.definition)}</div>
  ${t.synonyms?.length ? `<div class="term-meta"><strong>Also known as:</strong> ${escapeHtml(t.synonyms.join(", "))}</div>` : ""}
  ${t.ontologyReference ? `<div class="term-meta"><strong>Ontology:</strong> <a href="${escapeHtml(t.ontologyReference)}">${escapeHtml(t.ontologyReference)}</a></div>` : ""}
  ${t.datasets?.length ? `<div class="term-meta" style="margin-top:6px">${t.datasets.map((id) => `<span class="tag">${escapeHtml(dsTitleById.get(id) ?? id)}</span>`).join("")}</div>` : ""}
</div>`,
  )
  .join("")}
</div>
</section>`;
}

function renderContractsSection(contracts: DataContract[], datasets: Dataset[]): string {
  if (contracts.length === 0) return "";
  const dsById = new Map(datasets.map((d) => [d.id, d]));
  return `<section>
<h2>Data Contracts</h2>
${contracts
  .map((c) => {
    const ds = dsById.get(c.datasetId);
    if (!ds) return "";
    return `<div class="card${c.inferred ? " inferred" : ""}">
  <p class="card-title">${escapeHtml(ds.title)}${c.version ? `<span class="card-version">${escapeHtml(c.version)}</span>` : ""}${c.inferred ? '<span class="pill pill-inferred">Inferred</span>' : ""}</p>
  <div class="card-meta">${escapeHtml(ds.name)}${ds.owner ? ` · Owner: ${escapeHtml(ds.owner)}` : ""}${ds.steward ? ` · Steward: ${escapeHtml(ds.steward)}` : ""}</div>
  ${c.purpose ? `<div class="card-section"><div class="card-section-label">Purpose</div><div>${escapeHtml(c.purpose)}</div></div>` : ""}
  ${
    c.qualityRules?.length
      ? `<div class="card-section"><div class="card-section-label">Quality rules</div><ul>${c.qualityRules.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></div>`
      : ""
  }
  ${
    c.terms?.length
      ? `<div class="card-section"><div class="card-section-label">Terms</div><dl>${c.terms.map((t) => `<dt>${escapeHtml(t.term)}</dt><dd>${escapeHtml(t.commitment)}</dd>`).join("")}</dl></div>`
      : ""
  }
</div>`;
  })
  .join("")}
</section>`;
}

// ── Inline lineage SVG (compact, fits inside the PDF page) ─────────────

function renderLineageSvg(catalog: DataCatalog): string {
  if (catalog.lineageNodes.length === 0) return "";
  const layout = layoutLineage(catalog);
  if (layout.nodes.length === 0) return "";

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="-apple-system, system-ui, sans-serif">`,
  );
  parts.push(
    `<defs><marker id="lin-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1e293b"/></marker></defs>`,
  );
  parts.push(`<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`);

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const e of layout.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const sx = s.x + s.w;
    const sy = s.y + s.h / 2;
    const tx = t.x;
    const ty = t.y + t.h / 2;
    parts.push(
      `<path d="M ${sx} ${sy} C ${sx + 30} ${sy}, ${tx - 30} ${ty}, ${tx} ${ty}" fill="none" stroke="${e.inferred ? "#94a3b8" : "#475569"}" stroke-width="1" ${e.inferred ? 'stroke-dasharray="4 3"' : ""} marker-end="url(#lin-arr)"/>`,
    );
  }

  for (const n of layout.nodes) {
    const style =
      n.kind === "dataset"
        ? { bg: "#dbeafe", border: "#2563eb", rx: 4 }
        : n.kind === "job"
          ? { bg: "#fed7aa", border: "#ea580c", rx: 3 }
          : { bg: "#e5e7eb", border: "#6b7280", rx: 4 };
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${style.rx}" fill="${style.bg}" stroke="${style.border}" stroke-width="1" ${n.inferred ? 'stroke-dasharray="4 3"' : ""}/>`,
    );
    parts.push(
      `<text x="${n.x + n.w / 2}" y="${n.y + 8}" text-anchor="middle" font-size="6" font-weight="700" fill="#0f172a" opacity="0.6" letter-spacing="0.5">${n.kind.toUpperCase()}</text>`,
    );
    parts.push(
      `<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 2}" text-anchor="middle" font-size="9" font-weight="600" fill="#0f172a">${escapeHtml(trim(n.label, 18))}</text>`,
    );
    if (n.technology) {
      parts.push(
        `<text x="${n.x + n.w / 2}" y="${n.y + n.h - 6}" text-anchor="middle" font-size="7" fill="#64748b">[${escapeHtml(trim(n.technology, 16))}]</text>`,
      );
    }
  }

  parts.push(`</svg>`);
  return parts.join("");
}

interface PlacedLineageNode {
  id: string;
  kind: LineageNode["kind"];
  label: string;
  technology?: string;
  inferred: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PlacedLineageEdge {
  source: string;
  target: string;
  inferred: boolean;
}

/** Compact layered layout for the inline PDF lineage diagram. */
function layoutLineage(catalog: DataCatalog): {
  nodes: PlacedLineageNode[];
  edges: PlacedLineageEdge[];
  width: number;
  height: number;
} {
  const COL_W = 140;
  const ROW_H = 56;
  const NODE_W = 110;
  const NODE_H = 44;
  const PAD = 12;

  const nodes = catalog.lineageNodes;
  const edges: LineageEdge[] = catalog.lineageEdges;

  // Longest-path layering from in-degree-zero sources.
  const inEdges = new Map<string, string[]>();
  for (const n of nodes) inEdges.set(n.id, []);
  for (const e of edges) inEdges.get(e.target)?.push(e.source);

  const inDeg = new Map(nodes.map((n) => [n.id, inEdges.get(n.id)?.length ?? 0]));
  const queue: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);
  const order: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const e of edges) {
      if (e.source === id) {
        const d = (inDeg.get(e.target) ?? 0) - 1;
        inDeg.set(e.target, d);
        if (d <= 0 && !visited.has(e.target)) queue.push(e.target);
      }
    }
  }
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id);

  const layer = new Map<string, number>();
  for (const id of order) {
    let max = -1;
    for (const p of inEdges.get(id) ?? []) max = Math.max(max, layer.get(p) ?? 0);
    layer.set(id, max + 1);
  }

  const perLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = perLayer.get(l) ?? [];
    arr.push(n.id);
    perLayer.set(l, arr);
  }

  const placed: PlacedLineageNode[] = [];
  for (const [l, ids] of perLayer) {
    ids.forEach((id, i) => {
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      placed.push({
        id,
        kind: n.kind,
        label: n.label,
        technology: n.technology,
        inferred: n.inferred ?? false,
        x: PAD + l * COL_W,
        y: PAD + i * ROW_H,
        w: NODE_W,
        h: NODE_H,
      });
    });
  }

  const maxLayer = Math.max(0, ...Array.from(perLayer.keys()));
  const maxRow = Math.max(0, ...Array.from(perLayer.values()).map((v) => v.length - 1));
  const width = PAD * 2 + (maxLayer + 1) * COL_W;
  const height = PAD * 2 + (maxRow + 1) * ROW_H;

  return {
    nodes: placed,
    edges: edges.map((e) => ({ source: e.source, target: e.target, inferred: e.inferred ?? false })),
    width,
    height,
  };
}

// ── PDF pipeline ──────────────────────────────────────────────────────

/**
 * Render the audit-pack HTML to a multi-page A4 PDF, returned as a
 * `data:application/pdf;base64,…` URL so it slots into the same
 * download pipeline as the other format exporters.
 */
export async function renderDataCatalogPdf(catalog: DataCatalog): Promise<string> {
  const html = renderDataCatalogHtml(catalog);

  // Off-screen iframe for rasterisation.
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "0";
  iframe.style.width = "800px";
  iframe.style.height = "1000px";
  iframe.style.border = "none";
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
    });
    // Give the layout one frame to settle (web fonts, image-less but still).
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const body = iframe.contentDocument?.body;
    if (!body) throw new Error("PDF iframe body unavailable");

    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: 800,
      backgroundColor: "#ffffff",
    });

    const { jsPDF } = await import("jspdf");

    // Lay the tall rasterised image across multiple A4 pages.
    const pdfW = 595; // pt — A4 width
    const pdfH = 842; // pt — A4 height
    const imgPdfW = pdfW;
    const imgPdfH = (canvas.height / canvas.width) * imgPdfW;
    const pages = Math.max(1, Math.ceil(imgPdfH / pdfH));

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const imgData = canvas.toDataURL("image/jpeg", 0.85);
    for (let i = 0; i < pages; i++) {
      if (i > 0) doc.addPage();
      doc.addImage(imgData, "JPEG", 0, -i * pdfH, imgPdfW, imgPdfH);
    }
    return doc.output("datauristring");
  } finally {
    document.body.removeChild(iframe);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
