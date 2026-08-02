import type { ArtifactFiles } from "./interpreterProtocol";

type Resolver = () => Promise<ArtifactFiles>;

let resolver: Resolver | null = null;

/**
 * Bridge between the skills layer and the code interpreter. The active skills
 * provider registers a resolver so a skill's bundled resources (scripts,
 * references, assets) can be mounted into the sandbox on demand — this is what
 * makes the agentskills spec's tier-3 `scripts/` executable (e.g. the model can
 * `runpy.run_path("skills/<name>/scripts/extract.py")`).
 *
 * There is a single skills provider for the whole app, so one module-level slot
 * suffices.
 */
export function setSkillResourceResolver(fn: Resolver | null): void {
  resolver = fn;
}

/**
 * Resolve bundled resources for the skills selected by the active provider,
 * keyed `skills/<name>/<path>` so they mount under
 * `/home/user/skills/<name>/…`. The provider—not the model—owns this selection.
 */
export async function mountSkillFiles(): Promise<ArtifactFiles> {
  if (!resolver) return {};
  try {
    return await resolver();
  } catch {
    return {};
  }
}
