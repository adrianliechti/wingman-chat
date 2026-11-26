import type { SchemaInput } from "@tanstack/ai";
import { z } from "zod";

export function convertMcpToolSchema(schema: Record<string, unknown>): SchemaInput {
  try {
    return z.fromJSONSchema(schema);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Reference not found: ") || error.message.startsWith("External $ref is not supported,"))
    ) {
      // Publish the schema intact. A plain JSON Schema would make TanStack
      // resolve the same references at call time. Check only the MCP argument
      // envelope here and let the server validate its contents.
      return {
        "~standard": {
          version: 1,
          vendor: "wingman",
          jsonSchema: { input: () => schema, output: () => schema },
          validate(value: unknown) {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
              return { issues: [{ message: "MCP tool arguments must be an object" }] };
            }
            return { value };
          },
        },
      };
    }
    throw error;
  }
}
