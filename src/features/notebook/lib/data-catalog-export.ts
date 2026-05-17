/**
 * Pure-function exporters for a `DataCatalog`.
 *
 * No extra LLM calls — these are projections of the canonical catalog JSON
 * into three industry-standard wire formats:
 *
 * - DCAT 3 JSON-LD  (W3C Data Catalog Vocabulary)
 * - ODCS YAML       (Open Data Contract Standard — Bitol Foundation)
 * - OpenLineage     (Run events with input/output datasets)
 *
 * The exporters lean on the structure of the model — they don't validate
 * against the published JSON Schemas / SHACL shapes. Consumers can validate
 * downstream (https://json-ld.org/playground/, https://openlineage.io/spec/).
 */

import type { DataCatalog, DataContract, Dataset } from "../types/notebook";

// ── DCAT 3 JSON-LD ─────────────────────────────────────────────────────

interface DCATContext {
  "@context": Record<string, string>;
}

/**
 * Project the catalog into DCAT 3 JSON-LD. Each dataset becomes a
 * `dcat:Dataset`; each glossary term becomes a `skos:Concept`. Sensitivity
 * folds into `dct:accessRights`; regulatory tags fold into `dcat:keyword`.
 */
export function toDCATJSONLD(catalog: DataCatalog): string {
  const context: DCATContext["@context"] = {
    dcat: "http://www.w3.org/ns/dcat#",
    dct: "http://purl.org/dc/terms/",
    skos: "http://www.w3.org/2004/02/skos/core#",
    foaf: "http://xmlns.com/foaf/0.1/",
  };

  const datasetById = new Map<string, Dataset>(catalog.datasets.map((d) => [d.id, d]));

  const datasets = catalog.datasets.map((d) => ({
    "@type": "dcat:Dataset",
    "@id": `urn:dataset:${d.id}`,
    "dct:identifier": d.name,
    "dct:title": d.title,
    ...(d.description ? { "dct:description": d.description } : {}),
    ...(d.domain ? { "dcat:theme": d.domain } : {}),
    ...(d.owner ? { "dct:publisher": { "@type": "foaf:Organization", "foaf:name": d.owner } } : {}),
    ...(d.contact ? { "dcat:contactPoint": d.contact } : {}),
    ...(d.refreshCadence ? { "dcat:accrualPeriodicity": d.refreshCadence } : {}),
    ...(d.sensitivity ? { "dct:accessRights": d.sensitivity } : {}),
    ...(d.regulatoryTags && d.regulatoryTags.length > 0 ? { "dcat:keyword": d.regulatoryTags } : {}),
    ...(d.system || d.location
      ? {
          "dcat:distribution": [
            {
              "@type": "dcat:Distribution",
              ...(d.system ? { "dct:format": d.system } : {}),
              ...(d.location ? { "dcat:accessURL": d.location } : {}),
            },
          ],
        }
      : {}),
    ...(d.glossaryTerms && d.glossaryTerms.length > 0
      ? { "dct:subject": d.glossaryTerms.map((id) => ({ "@id": `urn:concept:${id}` })) }
      : {}),
    ...(d.inferred ? { "wingman:inferred": true } : {}),
  }));

  const concepts = catalog.glossary.map((t) => ({
    "@type": "skos:Concept",
    "@id": `urn:concept:${t.id}`,
    "skos:prefLabel": t.term,
    "skos:definition": t.definition,
    ...(t.synonyms && t.synonyms.length > 0 ? { "skos:altLabel": t.synonyms } : {}),
    ...(t.parent ? { "skos:broader": { "@id": `urn:concept:${t.parent}` } } : {}),
    ...(t.ontologyReference ? { "skos:exactMatch": { "@id": t.ontologyReference } } : {}),
    ...(t.datasets && t.datasets.length > 0
      ? { "dcat:relatedResource": t.datasets.filter((id) => datasetById.has(id)).map((id) => ({ "@id": `urn:dataset:${id}` })) }
      : {}),
    ...(t.inferred ? { "wingman:inferred": true } : {}),
  }));

  const document = {
    "@context": context,
    "@type": "dcat:Catalog",
    "dct:title": catalog.title,
    ...(catalog.summary ? { "dct:description": catalog.summary } : {}),
    "dcat:dataset": datasets,
    "skos:hasConcept": concepts,
  };

  return JSON.stringify(document, null, 2);
}

// ── OpenLineage JSON ───────────────────────────────────────────────────

const OPENLINEAGE_SCHEMA_URL = "https://openlineage.io/spec/2-0-0/OpenLineage.json";

/**
 * Project the lineage portion of the catalog into a sequence of OpenLineage
 * RunEvents. Each job in the lineage produces one `START` event with its
 * inputs and outputs. Run timestamps are synthetic (job creation order);
 * downstream tools accept this for static doc-import.
 */
export function toOpenLineageJSON(catalog: DataCatalog): string {
  const eventTime = new Date().toISOString();
  const datasetById = new Map<string, Dataset>(catalog.datasets.map((d) => [d.id, d]));

  // Build the dataset reference for a lineage node. Prefer the linked
  // `datasetId` (gives us a real name + system); fall back to the node label.
  const datasetRefFor = (nodeId: string): { namespace: string; name: string } | null => {
    const node = catalog.lineageNodes.find((n) => n.id === nodeId);
    if (!node || node.kind !== "dataset") return null;
    const ds = node.datasetId ? datasetById.get(node.datasetId) : undefined;
    return {
      namespace: ds?.system ?? "wingman",
      name: ds?.name ?? node.label,
    };
  };

  const jobs = catalog.lineageNodes.filter((n) => n.kind === "job");

  const events = jobs.map((job, idx) => {
    const inputs: { namespace: string; name: string }[] = [];
    const outputs: { namespace: string; name: string }[] = [];

    for (const edge of catalog.lineageEdges) {
      if (edge.target === job.id) {
        const ref = datasetRefFor(edge.source);
        if (ref) inputs.push(ref);
      }
      if (edge.source === job.id) {
        const ref = datasetRefFor(edge.target);
        if (ref) outputs.push(ref);
      }
    }

    const runUuid = `run-${idx.toString().padStart(4, "0")}-${job.id}`;

    return {
      eventType: "START",
      eventTime,
      producer: "https://github.com/adrianliechti/wingman-chat",
      schemaURL: OPENLINEAGE_SCHEMA_URL,
      run: { runId: runUuid },
      job: {
        namespace: job.technology ?? "wingman",
        name: job.label,
        ...(job.description
          ? { facets: { documentation: { _producer: "wingman-chat", _schemaURL: OPENLINEAGE_SCHEMA_URL, description: job.description } } }
          : {}),
      },
      inputs,
      outputs,
    };
  });

  return JSON.stringify(events, null, 2);
}

// ── ODCS YAML ──────────────────────────────────────────────────────────

/**
 * Project the contracts portion into a multi-document YAML stream (one doc
 * per contract, separated by `---` per Bitol convention).
 *
 * Hand-rolled emitter for the small ODCS surface — see `escapeYaml` /
 * `block` for the few rules we observe (quote strings that contain special
 * chars, use `|` for multi-line text, no anchors / aliases).
 */
export function toODCSYAML(catalog: DataCatalog): string {
  if (catalog.contracts.length === 0) return "# No contracts in this catalog\n";

  const datasetById = new Map<string, Dataset>(catalog.datasets.map((d) => [d.id, d]));
  const docs: string[] = [];

  for (const c of catalog.contracts) {
    const ds = datasetById.get(c.datasetId);
    if (!ds) continue;
    docs.push(odcsDocument(c, ds));
  }

  return docs.join("\n---\n");
}

function odcsDocument(c: DataContract, ds: Dataset): string {
  const lines: string[] = [];
  lines.push(`apiVersion: v3.0.0`);
  lines.push(`kind: DataContract`);
  lines.push(`id: ${ds.id}`);
  if (c.version) lines.push(`version: ${escapeYaml(c.version)}`);
  lines.push(`status: ${c.inferred ? "draft" : "proposed"}`);
  lines.push(`name: ${escapeYaml(ds.title)}`);

  lines.push(`info:`);
  lines.push(`  title: ${escapeYaml(ds.title)}`);
  if (ds.description) lines.push(`  description: ${escapeYaml(ds.description)}`);
  if (ds.owner) lines.push(`  owner: ${escapeYaml(ds.owner)}`);
  if (ds.steward) lines.push(`  steward: ${escapeYaml(ds.steward)}`);
  if (ds.contact) lines.push(`  contact: ${escapeYaml(ds.contact)}`);
  if (ds.domain) lines.push(`  domain: ${escapeYaml(ds.domain)}`);

  if (ds.system || ds.location) {
    lines.push(`servers:`);
    lines.push(`  - type: ${escapeYaml(ds.system ?? "unspecified")}`);
    if (ds.location) lines.push(`    location: ${escapeYaml(ds.location)}`);
  }

  if (c.purpose) {
    lines.push(`purpose: |`);
    for (const ln of c.purpose.split("\n")) lines.push(`  ${ln}`);
  }

  if (ds.fields && ds.fields.length > 0) {
    lines.push(`models:`);
    lines.push(`  ${ds.id}:`);
    lines.push(`    type: table`);
    lines.push(`    fields:`);
    for (const f of ds.fields) {
      lines.push(`      ${escapeYamlKey(f.name)}:`);
      if (f.type) lines.push(`        type: ${escapeYaml(f.type)}`);
      if (f.description) lines.push(`        description: ${escapeYaml(f.description)}`);
      if (f.primaryKey) lines.push(`        primaryKey: true`);
      if (f.nullable !== undefined) lines.push(`        required: ${!f.nullable}`);
      if (f.classification) lines.push(`        classification: ${escapeYaml(f.classification)}`);
    }
  }

  if (c.qualityRules && c.qualityRules.length > 0) {
    lines.push(`quality:`);
    for (const r of c.qualityRules) {
      lines.push(`  - rule: ${escapeYaml(r)}`);
    }
  }

  if (c.terms && c.terms.length > 0) {
    lines.push(`terms:`);
    for (const t of c.terms) {
      lines.push(`  ${escapeYamlKey(t.term)}: ${escapeYaml(t.commitment)}`);
    }
  }

  if (ds.regulatoryTags && ds.regulatoryTags.length > 0) {
    lines.push(`tags:`);
    for (const t of ds.regulatoryTags) lines.push(`  - ${escapeYaml(t)}`);
  }

  if (c.inferred || ds.inferred) {
    lines.push(`# NOTE: marked inferred by Wingman — review before publishing.`);
  }

  return lines.join("\n");
}

/** Quote YAML scalar if it contains characters that would confuse a parser. */
function escapeYaml(s: string): string {
  // Trigger characters: leading `:`/`-`/`?`/`#`/`!`/`*`/`&`/`|`/`>`, embedded `:` followed by space, `#` preceded by space,
  // leading/trailing whitespace, anything containing newlines.
  if (s.length === 0) return '""';
  if (/^[\s'"]/.test(s) || /[:#]\s|\n|^[-?*&!|>]/.test(s) || /^(true|false|null|yes|no)$/i.test(s) || /^-?\d/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}

/** Quote YAML keys that contain special characters. */
function escapeYamlKey(s: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

