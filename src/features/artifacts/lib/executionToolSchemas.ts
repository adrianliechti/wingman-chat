/**
 * Strict execution-tool schemas shared by the UI provider and compatibility
 * tests. Empty strings/arrays represent omitted values so providers do not
 * need to compile nullable unions for every optional argument.
 */
export const PYTHON_EXECUTION_PARAMETERS = {
  type: "object",
  properties: {
    code: {
      type: "string",
      description: 'Inline Python code to execute, or "" when running an existing script via path.',
    },
    path: {
      type: "string",
      description:
        'Path to an existing Python artifact (for example, "/analysis.py"), or "" when using inline code. Ignored when code is non-empty.',
    },
    skills: {
      type: "array",
      items: { type: "string" },
      description:
        "Skill names whose bundled resources should be mounted read-only under /home/user/skills/<name>/, or [] when none are needed.",
    },
  },
  required: ["code", "path", "skills"],
  additionalProperties: false,
};

export const JAVASCRIPT_EXECUTION_PARAMETERS = {
  type: "object",
  properties: {
    code: {
      type: "string",
      description: 'Inline JavaScript code to execute, or "" when running an existing script via path.',
    },
    path: {
      type: "string",
      description:
        'Path to an existing JavaScript artifact (for example, "/transform.js"), or "" when using inline code. Ignored when code is non-empty.',
    },
  },
  required: ["code", "path"],
  additionalProperties: false,
};
