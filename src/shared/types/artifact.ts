import { z } from "zod/v3";

export const ArtifactMutationSchema = z.object({
  operation: z.enum(["create", "update", "move", "delete"]),
  path: z.string().min(1),
  from: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  revision: z.string().optional(),
  checksum: z.string().optional(),
});

export const ArtifactDeltaSchema = z.object({
  mutations: z.array(ArtifactMutationSchema),
});

export type ArtifactMutation = z.infer<typeof ArtifactMutationSchema>;
export type ArtifactDelta = z.infer<typeof ArtifactDeltaSchema>;

export function artifactDelta(mutations: ArtifactMutation[]): ArtifactDelta {
  return ArtifactDeltaSchema.parse({ mutations });
}

export async function artifactChecksum(content: string, contentType?: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${contentType ?? ""}\0${content}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function artifactRevision(content: string, contentType?: string): Promise<string> {
  return `sha256:${await artifactChecksum(content, contentType)}`;
}

export function artifactDeltaFromMeta(meta: Record<string, unknown> | undefined): ArtifactDelta | null {
  const parsed = ArtifactDeltaSchema.safeParse(meta?.artifactDelta);
  return parsed.success ? parsed.data : null;
}

export type ArtifactJobPhase =
  | "briefing"
  | "planning"
  | "building"
  | "validating"
  | "repairing"
  | "ready"
  | "partial"
  | "failed"
  | "interrupted";

export const ArtifactJobSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().min(1),
  runId: z.string().optional(),
  kind: z.enum(["html", "slides", "docx", "xlsx", "pdf", "image", "audio", "data", "other"]),
  primaryPath: z.string().min(1),
  expected: z
    .object({
      units: z.number().int().positive().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
  phase: z.enum([
    "briefing",
    "planning",
    "building",
    "validating",
    "repairing",
    "ready",
    "partial",
    "failed",
    "interrupted",
  ]),
  revisionOf: z.string().optional(),
  variantOf: z.string().optional(),
  sourceRefs: z.array(z.string()).default([]),
  skillRefs: z.array(z.object({ name: z.string(), hash: z.string() })).default([]),
  repairAttempts: z.number().int().nonnegative().default(0),
  inferred: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ArtifactJob = z.infer<typeof ArtifactJobSchema>;

export const SourceRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  contentHash: z.string().optional(),
  retrievedAt: z.string().datetime().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const VerificationCheckSchema = z.object({
  id: z.string().min(1),
  scope: z.string().min(1),
  status: z.enum(["pass", "warn", "fail"]),
  message: z.string(),
});

export const VerificationReportSchema = z.object({
  status: z.enum(["clean", "warnings", "blocked"]),
  checks: z.array(VerificationCheckSchema),
  verifiedAt: z.string().datetime(),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

export const ArtifactUnitResultSchema = z.object({
  ordinal: z.number().int().positive(),
  path: z.string().optional(),
  status: z.enum(["ready", "failed", "missing"]),
  message: z.string().optional(),
  revision: z.string().optional(),
});
export type ArtifactUnitResult = z.infer<typeof ArtifactUnitResultSchema>;

export const ArtifactManifestSchema = z.object({
  jobId: z.string().min(1),
  primaryPath: z.string().min(1),
  files: z.array(
    z.object({
      path: z.string().min(1),
      role: z.enum(["primary", "asset", "source", "export"]),
      contentType: z.string().optional(),
      size: z.number().int().nonnegative(),
      revision: z.string(),
      checksum: z.string(),
    }),
  ),
  units: z.array(ArtifactUnitResultSchema).optional(),
  sources: z.array(SourceRefSchema).default([]),
  skillRefs: z.array(z.object({ name: z.string(), hash: z.string() })).default([]),
  promptLayerIds: z.array(z.string()).default([]),
  verification: VerificationReportSchema,
});
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;
