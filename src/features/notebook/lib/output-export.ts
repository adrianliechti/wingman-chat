/**
 * Per-output-type export catalogue.
 *
 * `getExportFormats(output)` returns the downloadable formats available for
 * any output type — the StudioPanel action menu uses this so the Download
 * entry-point lives in the same place for slides, diagrams, and data
 * catalogs.
 *
 * Each format is a plain `{ label, description, mime, run() }` record. `run`
 * resolves to the bytes (or data URL) the caller should download; the
 * StudioPanel handles the actual `<a download>` click.
 *
 * Slides are NOT routed through this module — they have a dedicated export
 * modal in StudioPanel with multi-step PPTX/PDF flows that don't fit the
 * single-button pattern.
 */

import {
  renderArchitectureDiagramSvg,
  svgToPngDataUrl,
} from "../components/architecture/svg-export";
import { renderProcessSvg } from "../components/process/svg-export";
import { toDCATJSONLD, toODCSYAML, toOpenLineageJSON } from "./data-catalog-export";
import { renderDataCatalogPdf } from "./data-catalog-pdf";
import type { NotebookOutput } from "../types/notebook";

export interface ExportFormat {
  /** Stable id used by the UI (e.g. "png", "svg", "dcat"). */
  id: string;
  /** Short display name shown in the menu. */
  label: string;
  /** One-line subtitle shown under the label. */
  description: string;
  /** Mime type for the downloaded file. */
  mime: string;
  /** Suffix appended to the slugged output title (without the leading dot). */
  extension: string;
  /** Resolve to the bytes or a data URL the caller should save. */
  run: () => Promise<string>;
  /** Optional disabled flag — used for "no contracts to export" cases. */
  disabled?: boolean;
  /** Override the subtitle when `disabled` is true. */
  disabledReason?: string;
}

/** Return the export formats available for an output, or [] if none. */
export function getExportFormats(output: NotebookOutput): ExportFormat[] {
  if (output.architecture) {
    const arch = output.architecture;
    return diagramFormats(() => renderArchitectureDiagramSvg(arch));
  }
  if (output.process) {
    const proc = output.process;
    return diagramFormats(() => renderProcessSvg(proc));
  }
  if (output.dataCatalog) return dataCatalogFormats(output);
  return [];
}

function diagramFormats(renderSvg: () => string): ExportFormat[] {
  return [
    {
      id: "png",
      label: "PNG",
      description: "2× resolution, white background",
      mime: "image/png",
      extension: "png",
      run: async () => svgToPngDataUrl(renderSvg(), 2),
    },
    {
      id: "svg",
      label: "SVG",
      description: "Vector — editable, scalable, smaller file",
      mime: "image/svg+xml;charset=utf-8",
      extension: "svg",
      run: async () => renderSvg(),
    },
  ];
}

function dataCatalogFormats(output: NotebookOutput): ExportFormat[] {
  const catalog = output.dataCatalog;
  if (!catalog) return [];
  const hasContent = catalog.datasets.length > 0 || catalog.glossary.length > 0;
  const hasContracts = catalog.contracts.length > 0;
  const hasLineageJobs = catalog.lineageNodes.some((n) => n.kind === "job");
  return [
    {
      id: "pdf",
      label: "PDF (audit pack)",
      description: "Human-readable document — cover, inventory, lineage, glossary, contracts",
      mime: "application/pdf",
      extension: "pdf",
      run: async () => renderDataCatalogPdf(catalog),
    },
    {
      id: "dcat",
      label: "DCAT 3 (JSON-LD)",
      description: "W3C standard — datasets + glossary as a JSON-LD catalog",
      mime: "application/ld+json",
      extension: "dcat.jsonld",
      run: async () => toDCATJSONLD(catalog),
      disabled: !hasContent,
      disabledReason: "No datasets or glossary to export",
    },
    {
      id: "odcs",
      label: "ODCS (YAML)",
      description: "Open Data Contract Standard — one doc per contract",
      mime: "application/yaml",
      extension: "odcs.yaml",
      run: async () => toODCSYAML(catalog),
      disabled: !hasContracts,
      disabledReason: "No contracts to export",
    },
    {
      id: "openlineage",
      label: "OpenLineage (JSON)",
      description: "Run events with input/output datasets — DataHub-compatible",
      mime: "application/json",
      extension: "openlineage.json",
      run: async () => toOpenLineageJSON(catalog),
      disabled: !hasLineageJobs,
      disabledReason: "No lineage jobs to export",
    },
  ];
}

/** Sluggify an output title for use as a filename. */
export function exportSlug(title: string): string {
  return title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "output";
}

/**
 * Trigger a browser download for the given format. Handles both data-URL
 * (`data:...`) returns from PNG rasterisation and plain text returns from
 * SVG/JSON/YAML exporters.
 */
export async function downloadFormat(output: NotebookOutput, format: ExportFormat): Promise<void> {
  const result = await format.run();
  const filename = `${exportSlug(output.title)}.${format.extension}`;
  const link = document.createElement("a");
  link.download = filename;
  if (result.startsWith("data:")) {
    link.href = result;
    link.click();
    return;
  }
  const blob = new Blob([result], { type: format.mime });
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
