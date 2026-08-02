import type { AgentBeforeFinishDecision } from "@/shared/lib/agent";
import { artifactDeltaFromMeta, ArtifactJobSchema, type ArtifactJob } from "@/shared/types/artifact";
import { Role, type Content, type Message } from "@/shared/types/chat";
import { findArtifactJobForRun, upsertArtifactJob, upsertArtifactManifest } from "./artifact-job-store";
import { verifyArtifactJob } from "./artifact-verifier";
import type { FileSystemManager } from "./fs";

interface ArtifactStopPolicyInput {
  chatId: string;
  runId: string;
  messages: Message[];
  fs: FileSystemManager;
  signal?: AbortSignal;
}

function artifactKind(path: string): ArtifactJob["kind"] {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "pptx") return "slides";
  if (extension === "docx") return "docx";
  if (extension === "xlsx") return "xlsx";
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension ?? "")) return "image";
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(extension ?? "")) return "audio";
  if (["csv", "tsv", "json", "jsonl"].includes(extension ?? "")) return "data";
  return "other";
}

function inferPrimaryPath(messages: Message[], runId: string): string | undefined {
  return [...messages]
    .reverse()
    .filter((message) => message.runId === runId)
    .flatMap((message) => message.content)
    .flatMap((part) => (part.type === "tool_result" ? (artifactDeltaFromMeta(part.meta)?.mutations ?? []) : []))
    .find((mutation) => mutation.operation !== "delete")?.path;
}

function finish(appendContent: Content[] = []): AgentBeforeFinishDecision {
  return appendContent.length > 0 ? { action: "finish", appendContent } : { action: "finish" };
}

/** Verify a Studio deliverable and decide whether the agent may finish or must repair it. */
export async function applyArtifactStopPolicy({
  chatId,
  runId,
  messages,
  fs,
  signal,
}: ArtifactStopPolicyInput): Promise<AgentBeforeFinishDecision> {
  if (signal?.aborted) return finish();

  let job = await findArtifactJobForRun(chatId, runId);
  if (!job) {
    const primaryPath = inferPrimaryPath(messages, runId);
    if (!primaryPath) return finish();
    const now = new Date().toISOString();
    job = ArtifactJobSchema.parse({
      id: crypto.randomUUID(),
      chatId,
      runId,
      kind: artifactKind(primaryPath),
      primaryPath,
      phase: "building",
      inferred: true,
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    });
    await upsertArtifactJob(chatId, job);
  }
  if (!job || signal?.aborted) return finish();

  job = { ...job, phase: "validating", updatedAt: new Date().toISOString() };
  await upsertArtifactJob(chatId, job);
  if (signal?.aborted) return finish();

  let manifest;
  try {
    manifest = await verifyArtifactJob(fs, job);
  } catch (error) {
    if (signal?.aborted) return finish();
    await upsertArtifactJob(chatId, { ...job, phase: "failed", updatedAt: new Date().toISOString() });
    return finish([
      {
        type: "text",
        text: `\n\nArtifact verification could not complete, so this deliverable is not marked ready: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }

  if (signal?.aborted) return finish();
  await upsertArtifactManifest(chatId, manifest);
  const failures = manifest.verification.checks.filter((item) => item.status === "fail");

  if (failures.length > 0 && job.repairAttempts < 2) {
    await upsertArtifactJob(chatId, {
      ...job,
      phase: "repairing",
      repairAttempts: job.repairAttempts + 1,
      updatedAt: new Date().toISOString(),
    });
    return {
      action: "continue",
      feedback: {
        role: Role.User,
        content: [
          {
            type: "runtime_feedback",
            source: "verification",
            text:
              "Artifact verification blocked readiness. Fix only these deterministic findings, then finish again:\n" +
              failures.map((item) => `- [${item.id}] ${item.message}`).join("\n"),
          },
        ],
      },
    };
  }

  const primary = manifest.files.find((file) => file.path === manifest.primaryPath);
  await upsertArtifactJob(chatId, {
    ...job,
    phase: failures.length === 0 ? "ready" : primary ? "partial" : "failed",
    updatedAt: new Date().toISOString(),
  });
  if (signal?.aborted) return finish();

  const appendContent: Content[] = [];
  if (failures.length > 0) {
    appendContent.push({
      type: "text",
      text:
        "\n\nArtifact verification remains incomplete after the repair budget was exhausted:\n" +
        failures.map((item) => `- ${item.message}`).join("\n"),
    });
  }
  if (primary) {
    appendContent.push({
      type: "artifact_ref",
      jobId: job.id,
      path: primary.path,
      revision: primary.revision,
      displayName: primary.path.split("/").pop() ?? primary.path,
    });
  }
  return finish(appendContent);
}
