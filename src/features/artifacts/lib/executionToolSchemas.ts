/**
 * Union-free execution-tool schemas shared by the UI provider and compatibility
 * tests. TanStack handles provider strictness; mutually exclusive
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
        'Path to a Python artifact or selected skill resource (for example, "/analysis.py" or "/skills/pdf/scripts/extract.py"). Omit when using inline code. Ignored when code is non-empty.',
    },
    args: {
      type: "array",
      items: { type: "string" },
      description: "Script arguments, excluding the script path. Available as sys.argv[1:]. Omit when unused.",
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
        'Path to a JavaScript artifact or selected skill resource (for example, "/transform.js" or "/skills/example/scripts/transform.js"). Omit when using inline code. Ignored when code is non-empty.',
    },
    args: {
      type: "array",
      items: { type: "string" },
      description: "Script arguments, excluding the script path. Available as process.argv.slice(2). Omit when unused.",
    },
    code: {
      type: "string",
      description: "Inline JavaScript code to execute. Omit when running an existing script via path.",
    },
  },
  required: [],
  additionalProperties: false,
};
