import type { ArtifactFiles } from "./interpreterProtocol";

type Resolver = () => Promise<ArtifactFiles>;

const resolvers = new Map<string, Resolver>();

/**
 * Bridge between the skills/plugins layer and the code interpreter. Each active
 * skills-like provider (the personal Skills tool, and independently each enabled
 * plugin) registers a resolver under its own provider id so a skill's bundled
 * resources (scripts, references, assets) can be mounted into the sandbox on
 * demand — this is what makes the agentskills spec's tier-3 `scripts/`
 * executable (e.g. the model can `runpy.run_path("skills/<name>/scripts/extract.py")`).
 *
 * Multiple providers can be enabled at once, so resolvers are keyed and merged.
 */
export function setSkillResourceResolver(id: string, fn: Resolver | null): void {
  if (fn) resolvers.set(id, fn);
  else resolvers.delete(id);
}

/**
 * Resolve bundled resources for every active provider's selected skills, keyed
 * `skills/<name>/<path>` so they mount under `/home/user/skills/<name>/…`. Each
 * provider—not the model—owns its own selection.
 */
export async function mountSkillFiles(): Promise<ArtifactFiles> {
  const files: ArtifactFiles = {};
  for (const resolver of resolvers.values()) {
    try {
      Object.assign(files, await resolver());
    } catch {
      // Skip a failing provider's resources; others still mount.
    }
  }
  return files;
}
