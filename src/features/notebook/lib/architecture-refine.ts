/**
 * Refinement of an existing architecture diagram.
 *
 * Round-trips the current diagram JSON through the LLM with a free-form user
 * edit instruction, then re-validates against the same strict zod schema used
 * by the initial generator. Returns an updated `NotebookOutput`. Throws on
 * failure — callers should surface errors in the UI.
 */

import { getConfig } from "@/shared/config";
import type { NotebookOutput } from "../types/notebook";
import { architectureSchema, normaliseArchitecture } from "./output-generators";

const REFINE_INSTRUCTIONS =
  "You are refining an existing software-architecture diagram for a regulated, finance-sector audience. " +
  "Apply the user's refinement request and return the **complete updated diagram** in the exact JSON schema requested. " +
  "Design freely: when the user asks for something the current diagram doesn't have, propose a sensible, technically credible addition (e.g. a Redis cache, an audit log, a DR site) and set `inferred: true` on the new elements/relations so the user can see what you proposed. " +
  "Preserve stable ids when possible so the user can recognise the diagram; only introduce new ids for genuinely new elements. " +
  "Every element id must be unique. Every relation must reference an existing element id. Every relation needs a verb-phrase `label`. " +
  "Keep the diagram's `kind` (c4-context, c4-container, c4-component, deployment, sequence, erd) unless the user explicitly asks you to switch to a different view.";

export async function refineArchitecture(output: NotebookOutput, refinement: string): Promise<NotebookOutput> {
  const current = output.architecture;
  if (!current) return output;

  const config = getConfig();
  const client = config.client;
  const model = config.notebook?.model || "";

  const input =
    `Current diagram JSON:\n\n${JSON.stringify(current, null, 2)}\n\n` + `Refinement request: ${refinement.trim()}`;

  const parsed = await client.parse(model, REFINE_INSTRUCTIONS, input, architectureSchema, "architecture_refine");
  if (!parsed?.elements?.length) return output;

  return { ...output, architecture: normaliseArchitecture(parsed) };
}
