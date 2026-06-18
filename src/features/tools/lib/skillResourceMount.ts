import type { ArtifactFiles } from "./interpreterProtocol";

type Resolver = (names: string[]) => Promise<ArtifactFiles>;

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
 * Resolve bundled resources for the named skills, keyed `skills/<name>/<path>`
 * so they mount under `/home/user/skills/<name>/…`. Returns {} when no resolver
 * is registered or no names are requested.
 */
export async function mountSkillFiles(names: string[]): Promise<ArtifactFiles> {
  if (!resolver || names.length === 0) return {};
  try {
    return await resolver(names);
  } catch {
    return {};
  }
}
