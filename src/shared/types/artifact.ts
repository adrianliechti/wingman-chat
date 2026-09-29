import { z } from "zod";

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

/** Keep generated-file paths current as tools update, move, or remove them. */
export function updateArtifactPaths(paths: Set<string>, mutations: ArtifactMutation[]): void {
  for (const mutation of mutations) {
    for (const path of paths) {
      if (
        path === mutation.path ||
        path.startsWith(`${mutation.path}/`) ||
        (mutation.from && (path === mutation.from || path.startsWith(`${mutation.from}/`)))
      )
        paths.delete(path);
    }
    if (mutation.operation !== "delete") paths.add(mutation.path);
  }
}

/** Who produced an artifact revision and why. Stored with the revision log. */
export const RevisionOriginSchema = z.object({
  actor: z.enum(["assistant", "user", "system"]),
  runId: z.string().optional(),
  reason: z.enum(["create", "edit", "upload", "restore", "execution", "rename", "delete", "bridge"]).optional(),
});
export type RevisionOrigin = z.infer<typeof RevisionOriginSchema>;

/** One entry of a per-path revision log; content lives in the revision file. */
export const ArtifactRevisionEntrySchema = z.object({
  revision: z.string().min(1),
  createdAt: z.string().datetime(),
  size: z.number().int().nonnegative(),
  contentType: z.string().optional(),
  origin: RevisionOriginSchema.optional(),
});
export type ArtifactRevisionEntry = z.infer<typeof ArtifactRevisionEntrySchema>;

export const ArtifactRevisionLogSchema = z.object({
  entries: z.array(ArtifactRevisionEntrySchema),
});
export type ArtifactRevisionLog = z.infer<typeof ArtifactRevisionLogSchema>;
