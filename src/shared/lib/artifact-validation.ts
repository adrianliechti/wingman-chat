export interface ArtifactValidationFile {
  path: string;
  content: string;
  contentType?: string;
}

export interface ArtifactValidationIssue {
  validator: string;
  message: string;
  line?: number;
  column?: number;
}

export interface ArtifactValidationResult {
  errors: ArtifactValidationIssue[];
  warnings: ArtifactValidationIssue[];
}

export interface ArtifactValidator {
  id: string;
  matches(file: ArtifactValidationFile): boolean;
  validate(file: ArtifactValidationFile): ArtifactValidationResult | Promise<ArtifactValidationResult>;
}

export const EMPTY_ARTIFACT_VALIDATION: ArtifactValidationResult = {
  errors: [],
  warnings: [],
};

/** Run every matching validator and merge their errors and warnings. */
export async function validateArtifact(
  file: ArtifactValidationFile,
  validators: readonly ArtifactValidator[],
): Promise<ArtifactValidationResult> {
  const result: ArtifactValidationResult = { errors: [], warnings: [] };

  for (const validator of validators) {
    try {
      if (!validator.matches(file)) continue;
      const next = await validator.validate(file);
      result.errors.push(...next.errors);
      result.warnings.push(...next.warnings);
    } catch (error) {
      result.errors.push({
        validator: validator.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export function formatArtifactValidationIssue(issue: ArtifactValidationIssue): string {
  const location = issue.line ? ` at line ${issue.line}${issue.column ? `, column ${issue.column}` : ""}` : "";
  return `[${issue.validator}]${location}: ${issue.message}`;
}
