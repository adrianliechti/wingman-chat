/**
 * Refinement of an existing data catalog.
 *
 * Round-trips the current catalog JSON through the LLM with a free-form user
 * edit instruction, then re-validates against the same strict zod schema
 * used by the initial generator. Returns an updated `NotebookOutput`. Throws
 * on failure — callers should surface errors in the UI.
 */

import { getConfig } from "@/shared/config";
import type { NotebookOutput } from "../types/notebook";
import { dataCatalogSchema, normaliseDataCatalog } from "./output-generators";

const REFINE_INSTRUCTIONS =
  "You are refining an existing data catalog for a regulated, finance-sector audience. " +
  "Apply the user's refinement request and return the **complete updated catalog** in the exact JSON schema requested. " +
  "Design freely: when the user asks for something not in the current catalog, propose a credible addition (a dataset, a contract, a lineage hop, a glossary term) and set `inferred: true` on the new items so the user can see what you proposed. " +
  "Preserve stable ids when possible so the user can recognise the catalog; only introduce new ids for genuinely new items. " +
  "Cross-references must resolve: glossary `parent`, glossary `datasets`, dataset `glossaryTerms`, lineage `datasetId`, lineage edge `source`/`target`, contract `datasetId`. " +
  "Standards: align inventory with DCAT 3, glossary with SKOS + FIBO, lineage with OpenLineage (dataset → job → dataset), contracts with ODCS (purpose, qualityRules, terms). " +
  "Keep the catalog's `kind` (inventory / glossary / lineage / contracts) unless the user explicitly asks for a different view.";

export async function refineDataCatalog(output: NotebookOutput, refinement: string): Promise<NotebookOutput> {
  const current = output.dataCatalog;
  if (!current) return output;

  const config = getConfig();
  const client = config.client;
  const model = config.notebook?.model || "";

  const input =
    `Current catalog JSON:\n\n${JSON.stringify(current, null, 2)}\n\n` + `Refinement request: ${refinement.trim()}`;

  const parsed = await client.parse(model, REFINE_INSTRUCTIONS, input, dataCatalogSchema, "data_catalog_refine");
  if (!parsed?.datasets) return output;

  const dataCatalog = normaliseDataCatalog(parsed);
  // Mirror the generator's emptiness check — a refinement must never silently
  // replace a populated catalog with an empty one when the model returns
  // schema-valid output that normalisation filters down to nothing.
  if (dataCatalog.datasets.length === 0 && dataCatalog.glossary.length === 0 && dataCatalog.lineageNodes.length === 0) {
    throw new Error("Refinement produced an empty catalog — keeping the current version");
  }

  return { ...output, dataCatalog };
}
