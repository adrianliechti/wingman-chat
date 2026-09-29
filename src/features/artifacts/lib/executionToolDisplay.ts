import { SquareCode } from "lucide-react";
import type { ToolDisplay } from "@/shared/types/chat";
import { scriptLanguageFromPath } from "@/features/tools/lib/scriptLanguage";

const RUNNING_CODE_WORDS = [
  "Coding",
  "Programming",
  "Computing",
  "Crunching",
  "Calculating",
  "Compiling",
  "Executing",
  "Processing",
  "Churning",
  "Crafting",
  "Tinkering",
  "Cooking",
  "Synthesizing",
  "Wrangling",
  "Reticulating",
];

function runningCodeLabel(callId = "script"): string {
  // Streaming arguments change on every token. A call's identity is stable
  // from its first partial argument through execution, including delegated calls.
  let hash = 0;
  for (let i = 0; i < callId.length; i++) hash = (hash * 31 + callId.charCodeAt(i)) | 0;
  return `${RUNNING_CODE_WORDS[Math.abs(hash) % RUNNING_CODE_WORDS.length]}…`;
}

export const SCRIPT_EXECUTION_DISPLAY: ToolDisplay = {
  header: (_args, state) => ({
    icon: SquareCode,
    label: state.error ? "Code hit a snag" : state.running ? runningCodeLabel(state.toolCallId) : "Ran code",
  }),
  input: (args) => {
    const code = typeof args?.code === "string" ? args.code : "";
    const language =
      typeof args?.language === "string"
        ? args.language
        : typeof args?.path === "string"
          ? scriptLanguageFromPath(args.path)
          : undefined;
    return code ? [{ code, language: language ?? "text" }] : [];
  },
};
