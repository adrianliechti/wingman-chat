import type { CodeExecutionRequest, CodeExecutionResult } from "@/features/tools/lib/interpreterProtocol";
import type { ExecuteCodeOptions } from "@/features/tools/lib/workerHost";
import { mountSkillFiles } from "@/features/tools/lib/skillResourceMount";
import { formatArtifactValidationIssue } from "@/shared/lib/artifact-validation";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { artifactDelta, type ArtifactMutation } from "@/shared/types/artifact";
import type { ToolContext } from "@/shared/types/chat";
import type { ArtifactWorkspaceAccess, FileSystemManager } from "./fs";
import { validateArtifactFile } from "./artifactValidators";

function failure(error: string): CodeExecutionResult {
  return { success: false, output: "", error };
}

type SandboxFiles = Record<string, { content: string; contentType?: string }>;

/**
 * Merge a skill's mounted resources into the sandbox file map, returning the
 * keys actually injected (skipping any that would shadow a real artifact). The
 * caller strips these from the post-run snapshot so read-only skill resources
 * never persist as artifacts.
 */
function mergeSkillFiles(base: SandboxFiles, skillFiles: SandboxFiles): Set<string> {
  const injected = new Set<string>();
  for (const [path, file] of Object.entries(skillFiles)) {
    if (path in base) continue;
    base[path] = file;
    injected.add(path);
  }
  return injected;
}

interface SnapshotValidation {
  errors: string[];
  warnings: string[];
}

/** Validate changed artifacts after an executor snapshot is committed. */
async function validateChangedArtifactFiles(before: SandboxFiles, after: SandboxFiles): Promise<SnapshotValidation> {
  const report: SnapshotValidation = { errors: [], warnings: [] };
  for (const [path, file] of Object.entries(after)) {
    const previous = before[path];
    if (previous?.content === file.content && previous.contentType === file.contentType) continue;
    const validation = await validateArtifactFile({ path, content: file.content, contentType: file.contentType });
    report.errors.push(...validation.errors.map((issue) => `${path}: ${formatArtifactValidationIssue(issue)}`));
    report.warnings.push(...validation.warnings.map((issue) => `${path}: ${formatArtifactValidationIssue(issue)}`));
  }
  return report;
}

function formatSnapshotValidation(report: SnapshotValidation): string {
  const sections: string[] = [];
  if (report.errors.length) {
    sections.push(
      `Validation errors (files were saved; continue editing and fix before finishing):\n${report.errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }
  if (report.warnings.length) {
    sections.push(`Validation warnings:\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}`);
  }
  return sections.length ? `\n${sections.join("\n")}` : "";
}

export type SandboxExecutor = (
  request: CodeExecutionRequest,
  options?: ExecuteCodeOptions,
) => Promise<CodeExecutionResult>;

async function executeCancellable(
  executor: SandboxExecutor,
  request: CodeExecutionRequest,
  options: ExecuteCodeOptions,
) {
  const signal = options.signal;
  if (!signal) return executor(request, options);
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    // A worker may still be queued behind another chat's run. Cancellation
    // releases this workspace immediately, even if that queue settles later.
    return await Promise.race([executor(request, options), cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** One workspace transaction for interpreter tools and editor Run buttons. */
export async function executeArtifactCode(options: {
  args: Record<string, unknown>;
  context?: ToolContext;
  executor: SandboxExecutor;
  extension: "py" | "js";
  fs: FileSystemManager | null;
  onCommit?: (access: ArtifactWorkspaceAccess, mutations: ArtifactMutation[]) => Promise<void>;
  limits?: CodeExecutionRequest["limits"];
  mountSkills?: boolean;
}): Promise<CodeExecutionResult> {
  const { args, context, executor, extension, mountSkills = false } = options;
  const inlineCode = typeof args.code === "string" ? args.code : "";

  const run = async (fs: ArtifactWorkspaceAccess | null): Promise<CodeExecutionResult> => {
    context?.signal?.throwIfAborted();
    const hasCode = inlineCode.trim().length > 0;
    const path = hasCode ? undefined : normalizeArtifactPath(typeof args.path === "string" ? args.path : undefined);

    if (!hasCode && !path) {
      return failure(
        "Error executing code: no `code` was received. If inline code failed to parse, escape quotes and " +
          `backslashes or write it to a \`.${extension}\` artifact and run it with \`path\`.`,
      );
    }

    // Prefer inline code: providers sometimes append `path` as if it were a
    // working-directory hint even though the schema describes a selector.
    let script = inlineCode;
    if (!hasCode && path) {
      if (!fs) return failure("Error executing code: file system not available.");
      const file = await fs.getFile(path);
      if (!file) return failure(`Error executing code: file not found: ${path}`);
      script = file.content;
    }

    const artifactFiles: SandboxFiles = fs ? await fs.getOverlaySnapshot() : {};
    const skillKeys = mountSkills ? mergeSkillFiles(artifactFiles, await mountSkillFiles()) : new Set<string>();
    context?.signal?.throwIfAborted();
    const result = await executeCancellable(
      executor,
      { code: script, files: artifactFiles, limits: options.limits },
      { signal: context?.signal, context },
    );
    if (!result.success) {
      return failure(`Error executing code: ${result.error || "Unknown error"}`);
    }

    let artifactValidation: SnapshotValidation = { errors: [], warnings: [] };
    if (fs && result.files) {
      context?.signal?.throwIfAborted();
      for (const key of skillKeys) delete result.files[key];
      const summary = await fs.applyOverlaySnapshot(result.files, { deleteMissing: true });
      await options.onCommit?.(fs, summary.mutations);
      if (summary.mutations.length > 0) {
        context?.setMeta?.({
          artifactFiles: [...summary.createdPaths, ...summary.updatedPaths],
          artifactDelta: artifactDelta(summary.mutations),
        });
      }
      artifactValidation = await validateChangedArtifactFiles(artifactFiles, result.files);
    }

    return { ...result, output: result.output + formatSnapshotValidation(artifactValidation) };
  };
  try {
    return options.fs ? await options.fs.withExclusiveAccess(run) : await run(null);
  } catch (error) {
    return failure(`Code execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
