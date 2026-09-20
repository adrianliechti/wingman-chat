import type { ArtifactRevisionEntry } from "@/shared/types/artifact";

/** Short badge text for who produced a revision. */
export function revisionActorLabel(entry: Pick<ArtifactRevisionEntry, "origin">): string {
  const origin = entry.origin;
  if (!origin) return "Unknown";
  if (origin.reason === "restore") return "Restored";
  if (origin.reason === "upload") return "Uploaded";
  if (origin.actor === "assistant") return "Assistant";
  if (origin.actor === "user") return "You";
  return "System";
}
