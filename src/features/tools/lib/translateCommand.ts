import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { getConfig } from "@/shared/config";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { getFileName } from "@/shared/lib/utils";
import { parseFlags, resolvePath, writeOutputFile } from "./commandUtils";
import { decodeStdin } from "./stdin";

const TRANSLATE_FLAGS = {
  "-l": "lang",
  "--lang": "lang",
  "-i": "input",
  "--input": "input",
  "-o": "output",
  "--output": "output",
};
const TRANSLATE_USAGE = 'usage: translate -l <lang> ["text" | -i input.file -o output.file]';

function requireTranslator() {
  const config = getConfig();
  if (!config.translator) {
    throw new Error("translate: no translation service configured");
  }
  return config;
}

/** Translate plain text into `lang`; returns the translated text. */
export async function runTranslateText(lang: string, text: string): Promise<string> {
  const config = requireTranslator();
  if (!lang.trim()) {
    throw new Error("translate: no target language provided");
  }
  if (!text.trim()) {
    throw new Error("translate: no text provided");
  }
  const result = await config.client.translate(lang, text);
  // A text input should come back as text; decode defensively if the backend
  // returns a binary blob anyway.
  if (typeof result !== "string") {
    return new TextDecoder().decode(new Uint8Array(await result.arrayBuffer()));
  }
  return result;
}

/** Translate a whole file into `lang`; returns the translated file bytes. */
export async function runTranslateFile(lang: string, bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const config = requireTranslator();
  if (!lang.trim()) {
    throw new Error("translate: no target language provided");
  }
  if (bytes.length === 0) {
    throw new Error(`translate: file is empty: ${path}`);
  }

  // Ship the original filename and content type so the backend routes the
  // upload by format, like the extractor does for `ocr`.
  const name = getFileName(path);
  const type = inferContentTypeFromPath(name) ?? "application/octet-stream";
  const file = new File([bytes as BlobPart], name, { type });

  const result = await config.client.translate(lang, file);
  // Some formats (e.g. plain text) come back as text rather than a file blob.
  if (typeof result === "string") {
    return new TextEncoder().encode(result);
  }
  const data = new Uint8Array(await result.arrayBuffer());
  if (data.length === 0) {
    throw new Error("translate: service returned an empty file");
  }
  return data;
}

async function executeTranslate(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const { options, rest, error } = parseFlags("translate", args, TRANSLATE_FLAGS);
  if (error) {
    return { stdout: "", stderr: `${error}\n`, exitCode: 2 };
  }

  const lang = options.lang?.at(-1);
  if (!lang) {
    return { stdout: "", stderr: `${TRANSLATE_USAGE}\n`, exitCode: 2 };
  }

  const input = options.input?.at(-1);
  const output = options.output?.at(-1);

  try {
    // File mode: read the input file, translate it, write the result.
    if (input) {
      if (!output) {
        return { stdout: "", stderr: "translate: file translation requires -o/--output\n", exitCode: 2 };
      }
      const fsPath = resolvePath(input, ctx.cwd);
      let bytes: Uint8Array;
      try {
        // readFileBuffer, not readFile — the latter decodes to UTF-8, which
        // destroys binary formats like PDF or docx.
        bytes = await ctx.fs.readFileBuffer(fsPath);
      } catch {
        return { stdout: "", stderr: `translate: cannot read file: ${input}\n`, exitCode: 1 };
      }
      const data = await runTranslateFile(lang, bytes, fsPath);
      await writeOutputFile(ctx.fs, resolvePath(output, ctx.cwd), data);
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Text mode: translate args (or piped stdin), print or write the result.
    const text = rest.join(" ").trim() || decodeStdin(ctx.stdin);
    if (!text) {
      return { stdout: "", stderr: "translate: no text provided (pass as args or pipe via stdin)\n", exitCode: 2 };
    }
    const result = await runTranslateText(lang, text);
    if (output) {
      await writeOutputFile(ctx.fs, resolvePath(output, ctx.cwd), result);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    return { stdout: result.endsWith("\n") ? result : `${result}\n`, stderr: "", exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

export const translateCommands: Command[] = [defineCommand("translate", executeTranslate)];
