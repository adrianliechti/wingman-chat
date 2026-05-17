/**
 * Refinement of an existing process diagram.
 *
 * Round-trips the current diagram JSON through the LLM with a free-form user
 * edit instruction, then re-validates against the same strict zod schema used
 * by the initial generator. Returns an updated `NotebookOutput`. Throws on
 * failure — callers should surface errors in the UI.
 */

import { getConfig } from "@/shared/config";
import type { NotebookOutput } from "../types/notebook";
import { normaliseProcess, processSchema } from "./output-generators";

const REFINE_INSTRUCTIONS =
  "You are refining an existing process diagram for a regulated, finance-sector audience. " +
  "Apply the user's refinement request and return the **complete updated diagram** in the exact JSON schema requested. " +
  "Design freely: when the user asks for something the diagram doesn't have, propose a sensible step / control / actor and set `inferred: true` on the new node(s) so the user can see what you proposed. " +
  "Modelling rules to preserve: exactly one `start`; at least one `end`; every `decision` has ≥ 2 outgoing edges with distinct labels; every node id is unique; every edge references an existing node id; every `lane` reference exists in `lanes`. " +
  "Keep stable node ids when possible so the user can recognise the diagram. Only introduce new ids for genuinely new nodes. " +
  "If the user asks for a control, regulation, or four-eye check, model it as a dedicated `task` node with `control` set to the framework reference (e.g. `SOX 404`, `BCBS 239`).";

export async function refineProcess(output: NotebookOutput, refinement: string): Promise<NotebookOutput> {
  const current = output.process;
  if (!current) return output;

  const config = getConfig();
  const client = config.client;
  const model = config.notebook?.model || "";

  const input =
    `Current diagram JSON:\n\n${JSON.stringify(current, null, 2)}\n\n` + `Refinement request: ${refinement.trim()}`;

  const parsed = await client.parse(model, REFINE_INSTRUCTIONS, input, processSchema, "process_refine");
  if (!parsed?.nodes?.length) return output;

  return { ...output, process: normaliseProcess(parsed) };
}
