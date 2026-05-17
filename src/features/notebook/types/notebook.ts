import type { Message } from "@/shared/types/chat";

export interface Notebook {
  id: string;
  title: string;
  customTitle?: string;
  createdAt: string;
  updatedAt: string;
}

export type OutputType = "podcast" | "slides" | "infographic" | "report" | "quiz" | "mindmap" | "process";

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

// ── Process diagram (BPMN-flavoured) ──────────────────────────────────
//
// Semantic schema for a business / software process. Lean enough for an LLM
// to populate via structured output, expressive enough to cover the common
// shapes a finance-sector audit will recognise (start/end events, tasks,
// gateways, swimlanes for org units / systems).

/** BPMN-style node kind. */
export type ProcessNodeKind =
  /** Process entry point — usually one per pool. */
  | "start"
  /** Terminal node — at least one required. */
  | "end"
  /** Generic activity / step performed by a role. */
  | "task"
  /** A sub-process or call to another documented process. */
  | "subprocess"
  /** Exclusive decision (XOR) — exactly one outgoing branch taken. */
  | "decision"
  /** Parallel split / join (AND). */
  | "parallel"
  /** Intermediate event (timer, message, signal, …). */
  | "event"
  /** Data store / system of record reference. */
  | "data";

export interface ProcessNode {
  /** Stable id used by edges to reference this node. */
  id: string;
  /** Short label rendered inside the shape (≤ 6 words). */
  label: string;
  /** BPMN-flavoured shape selector. */
  kind: ProcessNodeKind;
  /** Optional swimlane id (see `ProcessLane`). Nodes without a lane render in a default lane. */
  lane?: string;
  /** Optional one-line description / acceptance criteria — surfaced on hover. */
  description?: string;
  /** Optional reference to a control, policy, regulation, or KPI (e.g. "SOX 404", "ISO 27001 A.9"). */
  control?: string;
}

export interface ProcessEdge {
  /** Stable id. */
  id: string;
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Optional label — required on outgoing edges of a `decision` (e.g. "yes" / "no"). */
  label?: string;
  /** Sequence flow (default) vs. message flow (across pools/lanes). */
  flow?: "sequence" | "message";
}

export interface ProcessLane {
  /** Stable id used by `ProcessNode.lane`. */
  id: string;
  /** Display label (role, team, or system — e.g. "Compliance", "Core Banking System"). */
  label: string;
}

export interface ProcessDiagram {
  /** Process display title (e.g. "Customer Onboarding — KYC"). */
  title: string;
  /** Optional process goal / summary — shown above the diagram. */
  summary?: string;
  /** Swimlanes (roles or systems). Order is rendered top→bottom (horizontal layout). */
  lanes: ProcessLane[];
  /** Activities and events that make up the process. */
  nodes: ProcessNode[];
  /** Connections between nodes. */
  edges: ProcessEdge[];
}

export interface NotebookOutput {
  id: string;
  type: OutputType;
  title: string;
  content: string;
  imageUrl?: string;
  /** Slide payloads. Interpretation depends on `slideContentType`:
   *  - `text/html`  → each entry is a self-contained HTML document (1920×1080)
   *  - `image/png`  → each entry is a PNG data URL
   */
  slides?: string[];
  slideContentType?: string;
  audioUrl?: string;
  quiz?: QuizQuestion[];
  mindMap?: MindMapNode;
  process?: ProcessDiagram;
  status: "generating" | "completed" | "error";
  error?: string;
  createdAt: string;
}

export type NotebookMessage = Message & { timestamp: string };
