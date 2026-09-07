import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import type { Tool } from "../types/chat";

function describeIssue(error: ErrorObject, tool: Tool): string {
  const missing =
    error.keyword === "required" ? (error.params as { missingProperty?: string }).missingProperty : undefined;
  const extra =
    error.keyword === "additionalProperties"
      ? (error.params as { additionalProperty?: string }).additionalProperty
      : undefined;
  const suffix = missing
    ? `${error.instancePath}/${missing}`
    : extra
      ? `${error.instancePath}/${extra}`
      : error.instancePath;
  let hint = "";
  if (extra && error.instancePath === "") {
    const properties = tool.parameters.properties as Record<string, { default?: unknown }> | undefined;
    const flag = `-${extra}`;
    // Suggest only a declared flag with a missing hyphen. Never rewrite args or
    // guess aliases; the caller still has to send a valid, intentional call.
    if (properties && Object.hasOwn(properties, flag)) {
      hint = `. Use the declared parameter ${JSON.stringify(flag)}, including the leading hyphen`;
      if (Object.hasOwn(properties[flag], "default")) {
        hint += `, or omit it to use its default (${JSON.stringify(properties[flag].default)})`;
      }
    }
  }
  return `$args${suffix} ${error.message ?? "is invalid"}${hint}`;
}

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

export class ToolArgumentValidationError extends Error {
  readonly issues: string[];

  constructor(toolName: string, issues: string[]) {
    super(`Invalid arguments for ${toolName}: ${issues.slice(0, 4).join("; ")}`);
    this.name = "ToolArgumentValidationError";
    this.issues = issues;
  }
}

export class ToolRegistry {
  readonly tools: Tool[];
  private readonly byName: Map<string, Tool>;
  private readonly validators: Map<Tool, ValidateFunction>;

  constructor(tools: readonly Tool[]) {
    this.tools = [...tools];
    this.byName = new Map();
    this.validators = new Map();
    const ajv = new Ajv2020({
      addUsedSchema: false,
      allErrors: true,
      allowUnionTypes: true,
      strict: false,
      validateFormats: false,
      validateSchema: false,
    });
    for (const tool of this.tools) {
      const name = tool.name.trim();
      if (!name) throw new ToolRegistryError("Tool names must not be empty");
      if (name !== tool.name)
        throw new ToolRegistryError(`Tool name must not have surrounding whitespace: ${tool.name}`);
      if (this.byName.has(name)) throw new ToolRegistryError(`Duplicate tool name: ${name}`);
      this.byName.set(name, tool);
      try {
        this.validators.set(tool, ajv.compile(tool.parameters));
      } catch (error) {
        throw new ToolRegistryError(
          `Invalid JSON Schema for tool "${name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  parse(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
    const validator = this.validators.get(tool);
    if (!validator) throw new ToolRegistryError(`Tool is not registered: ${tool.name}`);
    if (!validator(args)) {
      throw new ToolArgumentValidationError(
        tool.name,
        (validator.errors ?? []).map((issue) => describeIssue(issue, tool)),
      );
    }
    return args;
  }
}

export function compileToolRegistry(tools: readonly Tool[]): ToolRegistry {
  return new ToolRegistry(tools);
}
