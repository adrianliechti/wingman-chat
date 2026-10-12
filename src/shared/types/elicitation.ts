export type ElicitationValue = string | number | boolean | string[];

export type ElicitationStringSchema = {
  type: "string";
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  format?: "email" | "uri" | "date" | "date-time";
  default?: string;
};

export type ElicitationNumberSchema = {
  type: "number" | "integer";
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: number;
};

export type ElicitationBooleanSchema = {
  type: "boolean";
  title?: string;
  description?: string;
  default?: boolean;
};

export type ElicitationSingleSelectSchema = {
  type: "string";
  title?: string;
  description?: string;
  enum?: string[];
  enumNames?: string[];
  oneOf?: Array<{
    const: string;
    title: string;
  }>;
  default?: string;
};

export type ElicitationMultiSelectSchema = {
  type: "array";
  title?: string;
  description?: string;
  minItems?: number;
  maxItems?: number;
  items: {
    type?: "string";
    enum?: string[];
    anyOf?: Array<{
      const: string;
      title: string;
    }>;
  };
  default?: string[];
};

export type ElicitationPrimitiveSchema =
  | ElicitationStringSchema
  | ElicitationNumberSchema
  | ElicitationBooleanSchema
  | ElicitationSingleSelectSchema
  | ElicitationMultiSelectSchema;

export type ElicitationSchema = {
  $schema?: string;
  type: "object";
  properties: Record<string, ElicitationPrimitiveSchema>;
  required?: string[];
};

/** The exact tool input a person approves before it is sent. */
export type ToolApproval = {
  /** Display name of the tool, e.g. "Web Fetch". */
  tool: string;
  /** Service that receives the input, when it isn't the tool itself. */
  source?: string;
  input: Record<string, unknown>;
  /** Arguments that carry the request itself; the rest are folded away. */
  primary?: string[];
};

export type FormElicitation = {
  mode?: "form";
  message: string;
  /** App-owned display name of the service requesting input. */
  source?: string;
  requestedSchema?: ElicitationSchema;
  /** App-owned pre-call approval; never supplied by a remote MCP schema. */
  approval?: ToolApproval;
  /** Local presentation hints for ask_questions; never alter a remote MCP schema. */
  presentation?: {
    kind: "questions";
    /** JSON object keys may be reordered while an interrupt is serialized. */
    fieldOrder?: string[];
    fields: Record<string, QuestionPresentation>;
  };
};

export type QuestionChoice = {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
};

export type QuestionPresentation = {
  options?: QuestionChoice[];
  allowOther?: boolean;
};

export type UrlElicitation = {
  mode: "url";
  message: string;
  source?: string;
  url: string;
  elicitationId: string;
};

export type Elicitation = FormElicitation | UrlElicitation;

export type ElicitationResult = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, ElicitationValue>;
};

export type PendingElicitation = {
  toolCallId: string;
  toolName: string;
  elicitation: Elicitation;
  resolve: (result: ElicitationResult) => void;
  onCancel?: () => void;
  cleanup?: () => void;
  /** True after a URL elicitation was accepted, waiting for notifications/elicitation/complete */
  waiting?: boolean;
  /** True briefly after notifications/elicitation/complete is received, before the UI is dismissed */
  completed?: boolean;
};

export type RiskSeverity = "low" | "medium" | "high";

export type Consent = {
  message: string;
  severity?: RiskSeverity;
};

export type ConsentResult = {
  action: "accept" | "decline";
};

export type PendingConsent = {
  kind: "category" | "risk";
  id: string;
  name: string;
  consent: Consent;
};
