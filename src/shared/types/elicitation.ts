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

export type FormElicitation = {
  mode?: "form";
  message: string;
  requestedSchema?: ElicitationSchema;
};

export type UrlElicitation = {
  mode: "url";
  message: string;
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
  /** True after a URL elicitation was accepted, waiting for notifications/elicitation/complete */
  waiting?: boolean;
  /** True briefly after notifications/elicitation/complete is received, before the UI is dismissed */
  completed?: boolean;
};
