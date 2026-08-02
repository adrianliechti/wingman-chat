/**
 * Union-free execution-tool schemas shared by the UI provider and compatibility
 * tests. These tools are schema-guided rather than strict, so mutually exclusive
 * selectors can be omitted instead of serialized as
 * fake empty values. Keeping the small selector fields before the large payload
 * also avoids a Bedrock/Anthropic parameter-boundary failure seen with multiline
 * code followed by empty path/array arguments.
 */
export const PYTHON_EXECUTION_PARAMETERS = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        'Path to an existing Python artifact (for example, "/analysis.py"). Omit when using inline code. Ignored when code is non-empty.',
    },
    code: {
      type: "string",
      description: "Inline Python code to execute. Omit when running an existing script via path.",
    },
  },
  required: [],
  additionalProperties: false,
};

export const JAVASCRIPT_EXECUTION_PARAMETERS = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        'Path to an existing JavaScript artifact (for example, "/transform.js"). Omit when using inline code. Ignored when code is non-empty.',
    },
    code: {
      type: "string",
      description: "Inline JavaScript code to execute. Omit when running an existing script via path.",
    },
  },
  required: [],
  additionalProperties: false,
};
