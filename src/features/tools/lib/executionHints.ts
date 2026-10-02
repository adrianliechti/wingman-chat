import type { ScriptLanguage } from "./scriptLanguage";

/**
 * Deterministic hints appended to failed execute_script results.
 *
 * Each rule matches an error class the sandbox produces because of a sandbox
 * limitation or a documented pitfall, and states the fix in one sentence. The
 * model otherwise rediscovers these by trial, one failed run at a time.
 */

export interface ExecutionHintContext {
  language: ScriptLanguage;
  /** Workspace artifact paths (e.g. "/data/sales.csv") the run could see. */
  files: string[];
}

interface HintRule {
  languages?: ScriptLanguage[];
  /** Only the first matching rule of a group applies. */
  group?: string;
  pattern: RegExp;
  hint: string | ((match: RegExpExecArray, context: ExecutionHintContext) => string | undefined);
}

const MAX_SUGGESTED_FILES = 5;
const MAX_LISTED_FILES = 10;

/** Suggestions for common missing imports and sandbox limitations. */
const PYTHON_MODULE_ALTERNATIVES: Record<string, string> = {
  polars: "Use pandas or duckdb instead of polars.",
  requests: "There is no network access; read inputs from workspace files.",
  httpx: "There is no network access; read inputs from workspace files.",
  aiohttp: "There is no network access; read inputs from workspace files.",
  urllib3: "There is no network access; read inputs from workspace files.",
  pip: "Packages cannot be installed at runtime.",
  micropip: "Packages cannot be installed at runtime.",
  subprocess: "There is no host shell; call Python libraries directly.",
  fitz: "Use pypdf, pdfplumber or pdfminer for PDF text; rasterize_pdf for page images.",
  pymupdf: "Use pypdf, pdfplumber or pdfminer for PDF text; rasterize_pdf for page images.",
  pytesseract: "Use the ocr helper for text in images.",
  plotly: "Use matplotlib or seaborn for static charts, or an HTML artifact with echarts for interactive ones.",
};

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

/** Workspace paths that look like the file the script wanted. */
export function suggestWorkspaceFiles(missingPath: string, files: string[]): string[] {
  const wanted = basename(missingPath);
  const wantedStem = stem(wanted);
  if (!wanted) return [];
  const exact = files.filter((file) => basename(file).toLowerCase() === wanted.toLowerCase());
  if (exact.length) return exact.slice(0, MAX_SUGGESTED_FILES);
  const similar = files.filter((file) => {
    const candidate = stem(basename(file));
    return wantedStem.length >= 3 && (candidate.includes(wantedStem) || wantedStem.includes(candidate));
  });
  return similar.slice(0, MAX_SUGGESTED_FILES);
}

function missingFileHint(rawPath: string, context: ExecutionHintContext): string {
  const path = rawPath.trim();
  const sandboxed = context.language === "javascript" ? path : path.replace(/^\/home\/user\/?/, "/");
  const suggestions = suggestWorkspaceFiles(path, context.files);
  const parts: string[] = [`No workspace file matches "${path}".`];
  if (suggestions.length) {
    parts.push(`Similar workspace files: ${suggestions.join(", ")}.`);
  } else if (context.files.length) {
    const listed = context.files.slice(0, MAX_LISTED_FILES).join(", ");
    const more = context.files.length > MAX_LISTED_FILES ? ` and ${context.files.length - MAX_LISTED_FILES} more` : "";
    parts.push(`Workspace files: ${listed}${more}.`);
  } else {
    parts.push("The workspace has no files; create the input first or ask for it.");
  }
  if (context.language !== "javascript" && path.startsWith("/") && !path.startsWith("/home/user")) {
    parts.push(`Artifacts are mounted under /home/user/ (artifact ${sandboxed} is /home/user${sandboxed}).`);
  }
  return parts.join(" ");
}

const RULES: HintRule[] = [
  {
    languages: ["python"],
    pattern: /ModuleNotFoundError: No module named '([^']+)'/,
    hint: (match) => {
      const module = match[1];
      const root = module.split(".")[0];
      const alternative = PYTHON_MODULE_ALTERNATIVES[root];
      return (
        `Module "${module}" could not be imported. For a bundled package, add an explicit \`import ${root}\` ` +
        "so the loader can preload it; also check the full import path and any local modules. " +
        "Packages cannot be installed with pip/micropip or downloaded from the network. " +
        (alternative ?? "Use a bundled package listed in the code execution instructions or the standard library.")
      );
    },
  },
  {
    languages: ["python"],
    pattern:
      /cannot block in this browser sandbox|asyncio\.run\(\) cannot be called from a running event loop|This event loop is already running|stack switching/,
    hint: "Use top-level await (for example `await main()`) instead of asyncio.run, run_until_complete or run_sync.",
  },
  {
    languages: ["python"],
    group: "missing-file",
    pattern: /No such file or directory: '(?:python3?|pip3?|node|npm|npx|bash|sh|git|ffmpeg|convert|curl|wget)'/,
    hint: "There is no host shell or subprocess program in this sandbox. Call the equivalent Python library directly, or run shell pipelines with execute_script and language bash.",
  },
  {
    languages: ["python", "bash"],
    group: "missing-file",
    pattern: /No such file or directory: '([^']+)'|(\S+): No such file or directory|Script file not found: (\S+)/,
    hint: (match, context) => missingFileHint(match[1] ?? match[2] ?? match[3], context),
  },
  {
    languages: ["javascript"],
    group: "missing-file",
    pattern: /(?:ENOENT|[Ff]ile not found|No such file)[:\s]+["'`]?([^"'`\s]+)/,
    hint: (match, context) => missingFileHint(match[1], context),
  },
  {
    languages: ["python"],
    pattern: /read_xlsx|Extension "[^"]+" (?:is not|was not|not found)|(?:INSTALL|LOAD)\s+\w+/,
    hint: "The in-process DuckDB wheel ships no extensions and cannot INSTALL or LOAD any. Read Excel with pandas.read_excel (openpyxl) and register the frame with con.register(name, frame).",
  },
  {
    languages: ["python"],
    pattern: /RecordBatchReader' object has no attribute/,
    hint: "rel.arrow() returns a RecordBatchReader in this runtime. Use rel.to_arrow_table() for a pyarrow.Table or rel.df() for pandas.",
  },
  {
    languages: ["python"],
    pattern: /DTypePromotionError|could not be promoted by|Cannot cast array data from dtype/,
    hint: 'NumPy will not mix string and numeric dtypes implicitly. Give np.select or np.where a compatible default (for example default="") or cast the inputs first.',
  },
  {
    languages: ["python"],
    pattern:
      /Direct network access is disabled in the Python sandbox|URLError|ConnectionError|Name or service not known|getaddrinfo failed|Temporary failure in name resolution/,
    hint: "There is no network access from the interpreter. Read inputs from workspace files, or use the web tools from chat and save the result as an artifact first.",
  },
  {
    languages: ["python", "javascript"],
    pattern:
      /MemoryError|out of memory|Out of memory|Maximum call stack size exceeded|RangeError: Array buffer allocation failed/,
    hint: "The sandbox has limited memory. Process data in chunks, stream with DuckDB COPY or pyarrow readers, or reduce the dataset before loading it.",
  },
  {
    languages: ["javascript"],
    pattern:
      /ReferenceError: (document|window|localStorage|sessionStorage|navigator|HTMLElement|Image|XMLHttpRequest) is not defined/,
    hint: "The JavaScript sandbox is a Web Worker without a DOM. Use OffscreenCanvas and svgToPng for rendering, or build an HTML artifact for DOM-based output.",
  },
  {
    languages: ["javascript"],
    pattern:
      /require\(.*\) is not available|Cannot find module|Dynamic import is disabled|ReferenceError: (?:module|exports|__dirname|process\.\w+) is not defined/,
    hint: "No npm, CommonJS or ES module loading in the sandbox. Use the bundled globals (arrow, mediabunny, echarts, jsPDF, Buffer) and browser APIs only.",
  },
  {
    languages: ["javascript"],
    pattern: /Network access is disabled in the JavaScript sandbox|Failed to fetch/,
    hint: "Remote networking is disabled. Read workspace files with vfs.read/readBytes/readJSON or a local fetch of an artifact path.",
  },
  {
    languages: ["javascript"],
    pattern:
      /ReferenceError: fs is not defined|fs\.(?:readFileSync|writeFileSync|promises) is not a function|Cannot read properties of undefined \(reading '(?:readFileSync|writeFileSync)'\)/,
    hint: "Node fs is unavailable. Use vfs.read/readBytes/readJSON and vfs.write/writeBytes/writeJSON with artifact paths like /data.csv.",
  },
  {
    languages: ["bash"],
    group: "command-not-found",
    pattern:
      /(?:^|: )(python3?|pip3?|node|npm|npx|deno|ruby|perl|java|go|cargo|gcc|make)(?:[.\d]*)?: command not (?:found|available)/m,
    hint: (match) =>
      `Bash has no ${match[1]} runtime. Run that code with execute_script and language ${/^node|npm|npx|deno/.test(match[1]) ? "javascript" : "python"} instead.`,
  },
  {
    languages: ["bash"],
    group: "command-not-found",
    pattern: /(?:^|: )(?:apt(?:-get)?|brew|yum|apk|dnf|curl|wget|ssh|docker|git): command not (?:found|available)/m,
    hint: "Bash is a virtual shell with no host binaries, package installation or network. Only the built-in Unix commands listed in the instructions are available.",
  },
  {
    languages: ["bash"],
    group: "command-not-found",
    pattern: /: command not (?:found|available)/,
    hint: "Only the virtual Unix commands listed in the instructions are available; there are no host binaries. Use jq, awk, sed and friends, or another execute_script language for richer processing.",
  },
];

/** Hints for a failed run, most specific first, each at most once. */
export function executionHints(error: string, context: ExecutionHintContext): string[] {
  const hints: string[] = [];
  const groups = new Set<string>();
  for (const rule of RULES) {
    if (rule.languages && !rule.languages.includes(context.language)) continue;
    if (rule.group && groups.has(rule.group)) continue;
    const match = rule.pattern.exec(error);
    if (!match) continue;
    const hint = typeof rule.hint === "string" ? rule.hint : rule.hint(match, context);
    if (!hint) continue;
    if (rule.group) groups.add(rule.group);
    if (!hints.includes(hint)) hints.push(hint);
  }
  return hints;
}

/** The error text with any applicable hints appended. */
export function withExecutionHints(error: string, context: ExecutionHintContext): string {
  const hints = executionHints(error, context);
  if (!hints.length) return error;
  const label = hints.length === 1 ? "Hint" : "Hints";
  return `${error}\n\n${label}:\n${hints.map((hint) => `- ${hint}`).join("\n")}`;
}
