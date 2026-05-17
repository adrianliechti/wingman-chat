import type { Message } from "@/shared/types/chat";

export interface Notebook {
  id: string;
  title: string;
  customTitle?: string;
  createdAt: string;
  updatedAt: string;
}

export type OutputType =
  | "podcast"
  | "slides"
  | "infographic"
  | "report"
  | "quiz"
  | "mindmap"
  | "process"
  | "architecture"
  | "data-catalog";

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
  /** True when the model synthesized this node to fill a gap not present in the sources. */
  inferred?: boolean;
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
  /** Style id (`bpmn` / `swimlane` / `itil` / `sdlc` / `three-lines`). Drives the lane palette. */
  style?: string;
  /** Swimlanes (roles or systems). Order is rendered top→bottom (horizontal layout). */
  lanes: ProcessLane[];
  /** Activities and events that make up the process. */
  nodes: ProcessNode[];
  /** Connections between nodes. */
  edges: ProcessEdge[];
}

// ── Architecture diagram (C4 / Deployment / Sequence / ERD) ──────────
//
// Single schema, tagged by `kind`. Two diagram families:
//   - `c4`       — populates four C4 views (Context / Container / Component
//                  / Deployment) in one generation. Each element/relation/group
//                  carries `views[]` telling the viewer (and exporters) which
//                  tabs it belongs to.
//   - `sequence` — UML sequence diagram (ordered messages between actors).
//
// Soft fields are nullable for OpenAI structured-output compatibility.

/** Sub-views inside a combined C4 architecture output. */
export type ArchitectureView = "c4-context" | "c4-container" | "c4-component" | "deployment";

export type ArchitectureKind = "c4" | "sequence";

export type ArchitectureElementKind =
  // C4
  | "person"
  | "system"
  | "external-system"
  | "container"
  | "component"
  // Deployment (part of c4)
  | "deployment-node"
  // Sequence
  | "actor";

export interface ArchitectureElement {
  id: string;
  kind: ArchitectureElementKind;
  label: string;
  /** Tech stack tag for containers/components/deployment nodes ("Spring Boot", "PostgreSQL 15"). */
  technology?: string;
  /** One-liner shown beneath the label and surfaced in tooltips. */
  description?: string;
  /** Parent element id — used by nested deployment groups and components-within-containers. */
  parent?: string;
  /** UML stereotype tag (e.g. "<<datastore>>", "<<queue>>", "<<microservice>>"). */
  stereotype?: string;
  /** True when the model synthesized this element to fill a gap. */
  inferred?: boolean;
  /** For `kind: "c4"` only — which views this element appears in. Omitted for sequence. */
  views?: ArchitectureView[];
}

export interface ArchitectureRelation {
  id: string;
  source: string;
  target: string;
  /** Short verb phrase: "writes to", "publishes events to", "reads from". */
  label?: string;
  /** Transport / protocol annotation ("HTTPS/JSON", "AMQP", "JDBC"). */
  technology?: string;
  /** Relation flavour — drives arrow style. */
  kind?: "uses" | "includes" | "depends-on" | "message" | "response";
  /** Ordinal for sequence diagrams (1, 2, 3, …). Ignored by other kinds. */
  order?: number;
  /** True when the model synthesized this relation to fill a gap. */
  inferred?: boolean;
  /** For `kind: "c4"` outputs only — which views this relation appears in. */
  views?: ArchitectureView[];
}

export interface ArchitectureGroup {
  id: string;
  label: string;
  /** "system-boundary" = C4 SUT dashed outline. "deployment-group" = nested infra box. */
  kind?: "system-boundary" | "deployment-group";
  /** For `kind: "c4"` outputs only — which views this group appears in. */
  views?: ArchitectureView[];
}

export interface ArchitectureDiagram {
  title: string;
  summary?: string;
  /** Diagram family — drives layout and visual vocabulary. */
  kind: ArchitectureKind;
  elements: ArchitectureElement[];
  relations: ArchitectureRelation[];
  groups: ArchitectureGroup[];
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
  architecture?: ArchitectureDiagram;
  dataCatalog?: DataCatalog;
  status: "generating" | "completed" | "error";
  error?: string;
  createdAt: string;
}

// ── Data catalog (DCAT / ODCS / OpenLineage / SKOS+FIBO) ──────────────
//
// One canonical model populated by the LLM; the viewer dispatches on `kind`
// to one of four renderers (inventory / glossary / lineage / contracts).
// Exporters project the model into DCAT JSON-LD, ODCS YAML, or OpenLineage
// JSON — pure transformations, no extra LLM calls.

export type DataCatalogKind = "inventory" | "glossary" | "lineage" | "contracts";

export interface DatasetField {
  name: string;
  /** Datatype hint — SQL / proto / JSON-Schema-style ("uuid", "varchar(64)", "string", "timestamptz"). */
  type?: string;
  description?: string;
  /** Per-field classification — "PII", "sensitive", "public", "PCI", "PHI". */
  classification?: string;
  nullable?: boolean;
  primaryKey?: boolean;
}

export interface Dataset {
  id: string;
  /** Fully-qualified name: "core_banking.public.accounts", topic name, S3 URI. */
  name: string;
  /** Short human title. */
  title: string;
  description?: string;
  /** Data domain / product / bounded context. */
  domain?: string;
  /** Storage system: "Snowflake", "BigQuery", "Kafka", "S3", "PostgreSQL". */
  system?: string;
  /** Physical location: URI, FQN, topic name, bucket+prefix. */
  location?: string;
  /** Refresh cadence: "real-time" / "hourly" / "daily" / "weekly" / "on-demand". */
  refreshCadence?: string;
  /** SLA in plain English: "Available 24×7, RPO 1h, RTO 4h". */
  sla?: string;
  fields?: DatasetField[];
  /** Business owner — accountable. */
  owner?: string;
  /** Technical steward — responsible. */
  steward?: string;
  /** Distribution list / Slack channel for questions. */
  contact?: string;
  /** Sensitivity: "public" | "internal" | "confidential" | "restricted". */
  sensitivity?: string;
  /** Regulatory tags: "GDPR-PII", "BCBS-239-CDE", "PCI-scope", "MiFID-trade-data". */
  regulatoryTags?: string[];
  /** Glossary term ids realised in this dataset. */
  glossaryTerms?: string[];
  /** True when the model synthesised this dataset (not explicitly named in sources). */
  inferred?: boolean;
}

export interface GlossaryTerm {
  id: string;
  /** Term name — PascalCase or natural language ("Counterparty", "Trade Date"). */
  term: string;
  /** Business-English definition. */
  definition: string;
  /** External ontology / vocabulary link — FIBO IRI, SKOS URI. */
  ontologyReference?: string;
  synonyms?: string[];
  /** Parent term id — broader concept. */
  parent?: string;
  /** Dataset ids where this term is realised. */
  datasets?: string[];
  inferred?: boolean;
}

export interface LineageNode {
  id: string;
  /** Lineage node kind: a dataset, a job / transformation, or an external system. */
  kind: "dataset" | "job" | "external";
  label: string;
  /** Reference to a `Dataset.id` when `kind === "dataset"`. */
  datasetId?: string;
  /** Job tooling: "dbt", "Airflow", "Spark", "Glue", "Fivetran". */
  technology?: string;
  description?: string;
  inferred?: boolean;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  /** Transformation type: "ingest" | "transform" | "publish" | "replicate". */
  kind?: "ingest" | "transform" | "publish" | "replicate";
  label?: string;
  inferred?: boolean;
}

export interface DataContractTerm {
  /** Term name: "Availability", "Freshness", "Quality", "Retention", "Security". */
  term: string;
  /** SLA / commitment text in plain English. */
  commitment: string;
}

export interface DataContract {
  /** Dataset id this contract is for. */
  datasetId: string;
  /** Semver: "v1.0.0". */
  version?: string;
  /** Purpose / use cases. */
  purpose?: string;
  /** Quality rules in plain language. */
  qualityRules?: string[];
  /** Service-level terms. */
  terms?: DataContractTerm[];
  inferred?: boolean;
}

export interface DataCatalog {
  title: string;
  summary?: string;
  /** Selected view — drives which renderer is primary. */
  kind: DataCatalogKind;
  datasets: Dataset[];
  glossary: GlossaryTerm[];
  lineageNodes: LineageNode[];
  lineageEdges: LineageEdge[];
  contracts: DataContract[];
}

export type NotebookMessage = Message & { timestamp: string };
