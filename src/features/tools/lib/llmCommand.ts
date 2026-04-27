import type { Command, CommandContext, ExecResult } from "just-bash/browser";
import { defineCommand } from "just-bash/browser";
import { getConfig } from "@/shared/config";
import { getTextFromContent, Role } from "@/shared/types/chat";

let activeChatModel: string | null = null;

export function setActiveLlmModel(model: string | null): void {
  activeChatModel = model;
}

export function resolveLlmModel(): string | null {
  return activeChatModel;
}

export async function runLlm(prompt: string): Promise<string> {
  const model = resolveLlmModel();
  if (!model) {
    throw new Error("llm: no active chat model");
  }

  const client = getConfig().client;
  const result = await client.complete(
    model,
    "",
    [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
    [],
  );
  return getTextFromContent(result.content);
}

async function executeLlm(args: string[], ctx: CommandContext): Promise<ExecResult> {
  let prompt = args.join(" ").trim();
  if (!prompt && ctx.stdin) {
    prompt = ctx.stdin;
  }

  if (!prompt) {
    return { stdout: "", stderr: "llm: no prompt provided (pass as args or pipe via stdin)\n", exitCode: 2 };
  }

  try {
    const text = await runLlm(prompt);
    return { stdout: text.endsWith("\n") ? text : `${text}\n`, stderr: "", exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

export const llmCommands: Command[] = [defineCommand("llm", executeLlm)];
