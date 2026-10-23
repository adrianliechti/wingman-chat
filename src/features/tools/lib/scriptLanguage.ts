export type ScriptLanguage = "python" | "javascript" | "bash";

export function scriptLanguageFromPath(path: string): ScriptLanguage | undefined {
  const extension = path.match(/\.([^./]+)$/)?.[1].toLowerCase();
  switch (extension) {
    case "py":
      return "python";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "sh":
    case "bash":
      return "bash";
    default:
      return undefined;
  }
}

function languageFromShebang(code: string): ScriptLanguage | undefined {
  const line = code.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  if (!line.startsWith("#!")) return undefined;
  const words = line.slice(2).trim().split(/\s+/);
  let command = words.shift()?.split("/").pop();
  if (command === "env") {
    if (words[0] === "-S") words.shift();
    command = words.shift();
  }
  if (command && /^python(?:3(?:\.\d+)?)?$/.test(command)) return "python";
  if (command === "node" || command === "nodejs") return "javascript";
  if (command === "bash" || command === "sh") return "bash";
  return undefined;
}

/** Detect only from explicit metadata, never by guessing the source syntax. */
/** Spellings models send for the three runtimes. */
const LANGUAGE_ALIASES: Record<string, ScriptLanguage> = {
  python: "python",
  python3: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  mjs: "javascript",
  node: "javascript",
  nodejs: "javascript",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
};

export function normalizeScriptLanguage(language: unknown): ScriptLanguage | undefined {
  if (typeof language !== "string") return undefined;
  return LANGUAGE_ALIASES[language.trim().toLowerCase()];
}

export function resolveScriptLanguage(language: unknown, path: string | undefined, code: string): ScriptLanguage {
  if (language !== undefined && language !== null && language !== "") {
    const normalized = normalizeScriptLanguage(language);
    if (normalized) return normalized;
    throw new Error("Unsupported script language. Use python, javascript, or bash.");
  }
  if (!path) throw new Error("Inline code requires language: python, javascript, or bash.");
  const detected = languageFromShebang(code) ?? scriptLanguageFromPath(path);
  if (detected) return detected;
  throw new Error(`Cannot detect the interpreter for ${path}. Set language to python, javascript, or bash.`);
}
