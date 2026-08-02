/**
 * Strict declaration schema kept separate from the React provider so the
 * gateway compatibility suite can exercise the exact production shape.
 * Zero/empty-string values represent fields that are not applicable.
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
      type: "number",
      description: "Expected slides, pages, or segments, or 0 when not applicable.",
    },
    width: { type: "number", description: "Expected pixel width, or 0 when not applicable." },
    height: { type: "number", description: "Expected pixel height, or 0 when not applicable." },
    sourceRefs: { type: "array", items: { type: "string" }, description: "Source paths or URLs used." },
    revisionOf: { type: "string", description: 'Prior job id for a substantial redesign, or "".' },
    variantOf: { type: "string", description: 'Prior job id when variants were requested, or "".' },
  },
  required: ["kind", "primaryPath", "expectedUnits", "width", "height", "sourceRefs", "revisionOf", "variantOf"],
  additionalProperties: false,
};
