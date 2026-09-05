import {
  type ArtifactValidationFile,
  type ArtifactValidationIssue,
  type ArtifactValidationResult,
  type ArtifactValidator,
  EMPTY_ARTIFACT_VALIDATION,
  validateArtifact,
} from "@/shared/lib/artifact-validation";
import { isDataUrl } from "@/shared/lib/fileContent";
import { isMermaidPath, validateMermaidSource } from "@/shared/lib/mermaid";

const ok = (): ArtifactValidationResult => ({ errors: [], warnings: [] });
const failure = (validator: string, message: string, line?: number, column?: number): ArtifactValidationResult => ({
  errors: [{ validator, message, line, column }],
  warnings: [],
});

function hasExtension(path: string, extensions: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

function mimeType(file: ArtifactValidationFile): string {
  return file.contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

function hasMimeType(file: ArtifactValidationFile, ...types: string[]): boolean {
  return types.includes(mimeType(file));
}

function jsonLocation(content: string, error: unknown): Pick<ArtifactValidationIssue, "line" | "column"> {
  const message = error instanceof Error ? error.message : String(error);
  const explicit = message.match(/line\s+(\d+).*column\s+(\d+)/i);
  if (explicit) return { line: Number(explicit[1]), column: Number(explicit[2]) };

  const position = message.match(/position\s+(\d+)/i);
  if (!position) return {};
  const offset = Math.min(Number(position[1]), content.length);
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

const mermaidValidator: ArtifactValidator = {
  id: "mermaid",
  matches: (file) => !isDataUrl(file.content) && (isMermaidPath(file.path) || hasMimeType(file, "text/vnd.mermaid")),
  async validate(file) {
    try {
      await validateMermaidSource(file.content);
      return ok();
    } catch (error) {
      return failure("mermaid", error instanceof Error ? error.message : String(error));
    }
  },
};

const jsonValidator: ArtifactValidator = {
  id: "json",
  matches: (file) =>
    !isDataUrl(file.content) &&
    !hasExtension(file.path, [".json5", ".jsonc", ".jsonl", ".ndjson"]) &&
    (hasExtension(file.path, [".json", ".geojson", ".webmanifest"]) ||
      mimeType(file) === "application/json" ||
      mimeType(file).endsWith("+json")),
  validate(file) {
    try {
      JSON.parse(file.content);
      return ok();
    } catch (error) {
      const { line, column } = jsonLocation(file.content, error);
      return failure("json", error instanceof Error ? error.message : String(error), line, column);
    }
  },
};

const jsonLinesValidator: ArtifactValidator = {
  id: "json-lines",
  matches: (file) =>
    !isDataUrl(file.content) &&
    (hasExtension(file.path, [".jsonl", ".ndjson"]) || hasMimeType(file, "application/x-ndjson")),
  validate(file) {
    const errors: ArtifactValidationIssue[] = [];
    for (const [index, line] of file.content.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        JSON.parse(line);
      } catch (error) {
        const location = jsonLocation(line, error);
        errors.push({
          validator: "json-lines",
          message: error instanceof Error ? error.message : String(error),
          line: index + 1,
          column: location.column,
        });
      }
    }
    return { errors, warnings: [] };
  },
};

const xmlValidator: ArtifactValidator = {
  id: "xml",
  matches: (file) =>
    !isDataUrl(file.content) &&
    (hasExtension(file.path, [".svg", ".xml", ".xsd", ".xsl", ".xslt"]) ||
      hasMimeType(file, "image/svg+xml", "application/xml", "text/xml")),
  validate(file) {
    const isSvg = hasExtension(file.path, [".svg"]) || hasMimeType(file, "image/svg+xml");
    const document = new DOMParser().parseFromString(file.content, isSvg ? "image/svg+xml" : "application/xml");
    const parserError = document.querySelector("parsererror");
    if (parserError) {
      return failure("xml", parserError.textContent?.trim() || "The document is not well-formed XML.");
    }
    if (isSvg && document.documentElement.localName.toLowerCase() !== "svg") {
      return failure("xml", "An SVG artifact must have an <svg> root element.");
    }
    return ok();
  },
};

export const ARTIFACT_VALIDATORS: readonly ArtifactValidator[] = [
  mermaidValidator,
  jsonValidator,
  jsonLinesValidator,
  xmlValidator,
];

export function validateArtifactFile(file: ArtifactValidationFile): Promise<ArtifactValidationResult> {
  if (isDataUrl(file.content)) return Promise.resolve(EMPTY_ARTIFACT_VALIDATION);
  return validateArtifact(file, ARTIFACT_VALIDATORS);
}
