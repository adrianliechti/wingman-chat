import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { getConfig } from "@/shared/config";
import { getTextFromContent, Role } from "@/shared/types/chat";
import type { LlmCallOptions } from "./interpreterProtocol";
import { decodeStdin } from "./stdin";

const EFFORT_LEVELS = new Set(["none", "minimal", "low", "medium", "high"]);

// Default model for `llm` calls — kept in sync with the chat's selected model
// by ChatProvider. Per-call options override it.
let defaultModel: string | null = null;

export function setModel(newModel: string | null): void {
  defaultModel = newModel;
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

function parseLlmArgs(args: string[]): { options: LlmCallOptions; prompt: string; error?: string } {
  const options: LlmCallOptions = {};
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-m" || arg === "--model") {
      const value = args[++i];
      if (!value) return { options, prompt: "", error: `llm: option ${arg} requires an argument` };
      options.model = value;
    } else if (arg === "-s" || arg === "--system") {
      const value = args[++i];
      if (!value) return { options, prompt: "", error: `llm: option ${arg} requires an argument` };
      options.system = value;
    } else if (arg === "-e" || arg === "--effort") {
      const value = args[++i];
      if (!value || !EFFORT_LEVELS.has(value)) {
        return { options, prompt: "", error: `llm: option ${arg} requires one of: ${[...EFFORT_LEVELS].join(", ")}` };
      }
      options.effort = value as LlmCallOptions["effort"];
    } else {
      rest.push(arg);
    }
  }

  return { options, prompt: rest.join(" ").trim() };
}

async function executeLlm(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const { options, prompt: argPrompt, error } = parseLlmArgs(args);
  if (error) {
    return { stdout: "", stderr: `${error}\n`, exitCode: 2 };
  }

  let prompt = argPrompt;
  if (!prompt) {
    prompt = decodeStdin(ctx.stdin);
  }

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
