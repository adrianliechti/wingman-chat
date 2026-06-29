import { loadJSZip } from "@/shared/lib/lazy";
import { downloadBlob } from "@/shared/lib/utils";

/**
 * A bundled support file shipped alongside a skill (script, reference, asset).
 * Mirrors the on-disk layout: `path` is relative to the skill folder.
 */
export interface SkillResource {
  /** Path relative to the skill folder, e.g. "scripts/extract.py". */
  path: string;
  /** Raw text content, or a data: URL for binary files. */
  content: string;
  /** MIME type inferred from the path; picks text vs. binary storage. */
  contentType?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  compatibility?: string;
  resources?: SkillResource[];
}

export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  compatibility?: string;
  resources?: SkillResource[];
}

export interface SkillValidationError {
  field: string;
  message: string;
}

export type SkillParseResult =
  | { success: true; skill: ParsedSkill }
  | { success: false; errors: SkillValidationError[] };

// Skill name validation regex: unicode lowercase alphanumeric and hyphens
// No start/end hyphens, no consecutive hyphens
const SKILL_NAME_REGEX = /^[\p{Ll}\p{N}]+(-[\p{Ll}\p{N}]+)*$/u;

export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/**
 * Validate a skill name against the agentskills.io specification
 */
export function validateSkillName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: "Name is required" };
  }

  if (name.length < 1 || name.length > 64) {
    return { valid: false, error: "Name must be between 1 and 64 characters" };
  }

  if (!SKILL_NAME_REGEX.test(name)) {
    return {
      valid: false,
      error:
        "Name must contain only lowercase alphanumeric characters and hyphens. Cannot start or end with a hyphen or have consecutive hyphens.",
    };
  }

  return { valid: true };
}

/**
 * Validate a skill description (required, max length)
 */
export function validateSkillDescription(description: string): { valid: boolean; error?: string } {
  if (!description) {
    return { valid: false, error: "Description is required" };
  }

  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    return { valid: false, error: `Description must be ${SKILL_DESCRIPTION_MAX_LENGTH} characters or less` };
  }

  return { valid: true };
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } | null {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const frontmatterStr = match[1];
  const body = match[2].trim();

  // Simple YAML parsing for key: value pairs
  const frontmatter: Record<string, string> = {};
  const lines = frontmatterStr.split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Parse a SKILL.md file content and validate it
 */
export function parseSkillFile(content: string): SkillParseResult {
  const errors: SkillValidationError[] = [];

  const parsed = parseFrontmatter(content);

  if (!parsed) {
    errors.push({
      field: "format",
      message: "Invalid format: Expected YAML frontmatter between --- markers",
    });
    return { success: false, errors };
  }

  const { frontmatter, body } = parsed;

  // Validate name
  const name = frontmatter.name;
  if (!name) {
    errors.push({ field: "name", message: "Name is required in frontmatter" });
  } else {
    const nameValidation = validateSkillName(name);
    if (!nameValidation.valid) {
      errors.push({ field: "name", message: nameValidation.error ?? "Invalid skill name" });
    }
  }

  // Validate description
  const description = frontmatter.description;
  if (!description) {
    errors.push({ field: "description", message: "Description is required in frontmatter" });
  } else if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    errors.push({
      field: "description",
      message: `Description must be ${SKILL_DESCRIPTION_MAX_LENGTH} characters or less`,
    });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  if (!name || !description) {
    return {
      success: false,
      errors: [{ field: "format", message: "Missing required frontmatter fields" }],
    };
  }

  return {
    success: true,
    skill: {
      name,
      description,
      content: body,
      ...(frontmatter.compatibility ? { compatibility: frontmatter.compatibility } : {}),
    },
  };
}

/**
 * Serialize a skill to SKILL.md format with YAML frontmatter
 */
export function serializeSkill(skill: Skill): string {
  const lines = ["---", `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.compatibility) lines.push(`compatibility: ${skill.compatibility}`);
  lines.push("---", "", skill.content);

  return lines.join("\n");
}

/**
 * Download a single skill as a SKILL.md file
 */
export function downloadSkill(skill: Skill): void {
  const content = serializeSkill(skill);
  const blob = new Blob([content], { type: "text/markdown" });
  downloadBlob(blob, `${skill.name}.SKILL.md`);
}

/**
 * Download all skills as a zip file
 */
export async function downloadSkillsAsZip(skills: Skill[], filename: string = "skills.zip"): Promise<void> {
  if (skills.length === 0) {
    throw new Error("No skills to download");
  }

  const JSZip = await loadJSZip();
  const zip = new JSZip();

  for (const skill of skills) {
    const content = serializeSkill(skill);
    zip.file(`${skill.name}.SKILL.md`, content);
  }

  try {
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, filename);
  } catch (error) {
    throw new Error(`Failed to create zip file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
