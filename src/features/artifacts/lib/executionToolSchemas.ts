import { z } from "zod";

/**
 * Union-free execution-tool schemas shared by the UI provider and compatibility
 * tests. TanStack handles provider strictness; mutually exclusive
 * selectors can be omitted instead of serialized as
 * fake empty values. Keeping the small selector fields before the large payload
 * also avoids a Bedrock/Anthropic parameter-boundary failure seen with multiline
 * code followed by empty path/array arguments.
 */
export const SCRIPT_EXECUTION_SCHEMA = z.strictObject({
  path: z
    .string()
    .describe(
      'Path to an artifact script or selected skill resource (for example, "/analysis.py" or "/skills/example/scripts/run.sh"). The interpreter is detected from its shebang or extension (.py, .js/.mjs/.cjs, .sh/.bash). Omit when using inline code. Ignored when code is non-empty.',
    )
    .optional(),
  language: z
    .enum(["python", "javascript", "bash"])
    .describe(
      "Required for inline code. Optional for file scripts: overrides interpreter detection, or selects the runtime for a file without a recognized extension or shebang.",
    )
    .optional(),
  args: z
    .array(z.string())
    .describe(
      'Script arguments, excluding the script path. Available as sys.argv[1:] in Python, process.argv.slice(2) in JavaScript, or $1, $2, ... / "$@" in Bash. Omit when unused.',
    )
    .optional(),
  code: z
    .string()
    .describe("Inline code to execute in the specified language. Omit when running an existing script via path.")
    .optional(),
});
