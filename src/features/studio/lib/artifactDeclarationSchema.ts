/**
 * Declaration schema kept separate from the React provider so the
 * gateway compatibility suite can exercise the exact production shape.
 * Omit fields that are not applicable; legacy zero/empty values remain accepted.
 */
export const ARTIFACT_DECLARATION_PARAMETERS = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["html", "slides", "docx", "xlsx", "pdf", "image", "audio", "data", "other"],
    },
    primaryPath: { type: "string", description: "Planned primary artifact path." },
    expectedUnits: {
      type: "integer",
      minimum: 0,
      description: "Expected slides, pages, or segments. Omit when not applicable.",
    },
    width: { type: "integer", minimum: 0, description: "Expected pixel width. Omit when not applicable." },
    height: { type: "integer", minimum: 0, description: "Expected pixel height. Omit when not applicable." },
    sourceRefs: { type: "array", items: { type: "string" }, description: "Source paths or URLs used." },
    revisionOf: { type: "string", description: "Prior job id for a substantial redesign. Omit otherwise." },
    variantOf: { type: "string", description: "Prior job id when variants were requested. Omit otherwise." },
  },
  required: ["kind", "primaryPath"],
  additionalProperties: false,
};
