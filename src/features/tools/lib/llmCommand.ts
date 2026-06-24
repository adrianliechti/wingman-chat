import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { getConfig } from "@/shared/config";
import { getTextFromContent, Role } from "@/shared/types/chat";
import { parseFlags } from "./commandUtils";
import type { LlmCallOptions } from "./interpreterProtocol";
import { decodeStdin } from "./stdin";

const EFFORT_LEVELS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

const LLM_FLAGS = {
  "-m": "model",
  "--model": "model",
  "-s": "system",
  "--system": "system",
  "-e": "effort",
  "--effort": "effort",
};

// Default model for `llm` calls — kept in sync with the chat's selected model
// by ChatProvider. Per-call options override it.
let defaultModel: string | null = null;

export function setModel(newModel: string | null): void {
  defaultModel = newModel;
}

export function getModel(): string | null {
  return defaultModel;
}

export async function runLlm(prompt: string, options: LlmCallOptions = {}): Promise<string> {
  const model = options.model || defaultModel;
  if (!model) {
    throw new Error("llm: no model");
  }

  const result = await getConfig().client.complete(
    model,
    options.system ?? "",
    [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
    [],
    undefined,
    options.effort ? { effort: options.effort } : undefined,
  );
  return getTextFromContent(result.content);
}

async function executeLlm(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const { options: flags, rest, error } = parseFlags("llm", args, LLM_FLAGS);
  if (error) {
    return { stdout: "", stderr: `${error}\n`, exitCode: 2 };
  }

  const effort = flags.effort?.at(-1);
  if (effort && !EFFORT_LEVELS.has(effort)) {
    return {
      stdout: "",
      stderr: `llm: option --effort requires one of: ${[...EFFORT_LEVELS].join(", ")}\n`,
      exitCode: 2,
    };
  }

  const options: LlmCallOptions = {
    model: flags.model?.at(-1),
    system: flags.system?.at(-1),
    effort: effort as LlmCallOptions["effort"],
  };

  const prompt = rest.join(" ").trim() || decodeStdin(ctx.stdin);
  if (!prompt) {
    return { stdout: "", stderr: "llm: no prompt provided (pass as args or pipe via stdin)\n", exitCode: 2 };
  }

  try {
    const text = await runLlm(prompt, options);
    return { stdout: text.endsWith("\n") ? text : `${text}\n`, stderr: "", exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

export const llmCommands: Command[] = [defineCommand("llm", executeLlm)];
