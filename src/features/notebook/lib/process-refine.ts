/**
 * Refinement of an existing process diagram.
 *
 * Round-trips the current diagram JSON through the LLM with a free-form user
 * edit instruction, then re-validates against the same strict zod schema used
 * by the initial generator. Returns an updated `NotebookOutput`. Throws on
 * failure — callers should surface errors in the UI.
 */

import { z } from "zod/v3";
import { getConfig } from "@/shared/config";
import type { NotebookOutput, ProcessDiagram } from "../types/notebook";
import { processNodeKinds } from "./output-generators";

// Same nullable-only constraint as the initial generator — see comment in
// output-generators.ts. `null` is treated as "field absent" in the normaliser.
const refineSchema = z
  .object({
    title: z.string(),
    summary: z.string().nullable(),
    lanes: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
        })
        .strict(),
    ),
    nodes: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          kind: z.enum(processNodeKinds),
          lane: z.string().nullable(),
          description: z.string().nullable(),
          control: z.string().nullable(),
        })
        .strict(),
    ),
    edges: z.array(
      z
        .object({
          id: z.string(),
          source: z.string(),
          target: z.string(),
          label: z.string().nullable(),
          flow: z.enum(["sequence", "message"]).nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const REFINE_INSTRUCTIONS =
  "You are refining an existing process diagram for a regulated, finance-sector audience. " +
  "Apply the user's refinement request to the diagram below and return the **complete updated diagram** in the exact JSON schema requested. " +
  "Modelling rules you must preserve: exactly one `start`; at least one `end`; every `decision` has ≥ 2 outgoing edges with distinct labels; every node id is unique; every edge references an existing node id; every `lane` reference exists in `lanes`. " +
  "Keep stable node ids when possible so the user can recognise the diagram. Only introduce new ids for genuinely new nodes. " +
  "If the user asks for a control, regulation, or four-eye check, model it as a dedicated `task` node with `control` set to the framework reference (e.g. `SOX 404`, `BCBS 239`). " +
  "Be faithful — do not invent steps, actors, or systems that the user did not ask for.";

export async function refineProcess(output: NotebookOutput, refinement: string): Promise<NotebookOutput> {
  const current = output.process;
  if (!current) return output;

  const config = getConfig();
  const client = config.client;
  const model = config.notebook?.model || "";

  const input =
    `Current diagram JSON:\n\n${JSON.stringify(current, null, 2)}\n\n` + `Refinement request: ${refinement.trim()}`;

  const parsed = await client.parse(model, REFINE_INSTRUCTIONS, input, refineSchema, "process_refine");
  if (!parsed?.nodes?.length) return output;

  const laneIds = new Set(parsed.lanes.map((l) => l.id));
  const seenNodeIds = new Set<string>();
  const nodes = parsed.nodes
    .filter((n) => {
      if (seenNodeIds.has(n.id)) return false;
      seenNodeIds.add(n.id);
      return true;
    })
    .map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      ...(n.lane && laneIds.has(n.lane) ? { lane: n.lane } : {}),
      ...(n.description ? { description: n.description } : {}),
      ...(n.control ? { control: n.control } : {}),
    }));

  const validIds = new Set(nodes.map((n) => n.id));
  const seenEdgeIds = new Set<string>();
  const edges = parsed.edges
    .filter((e) => validIds.has(e.source) && validIds.has(e.target))
    .filter((e) => {
      if (seenEdgeIds.has(e.id)) return false;
      seenEdgeIds.add(e.id);
      return true;
    })
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      ...(e.flow === "message" ? { flow: "message" as const } : {}),
    }));

  const updated: ProcessDiagram = {
    title: parsed.title,
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    lanes: parsed.lanes,
    nodes,
    edges,
  };

  return { ...output, process: updated };
}
