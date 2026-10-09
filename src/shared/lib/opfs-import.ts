import { serializeAgentMd } from "@/features/agent/lib/agentMarkdown";
import type { Agent } from "@/features/agent/types/agent";
import { listDirectories, readJson } from "./opfs-core";

/** Identical copies are common in bundled exports; different bytes are ambiguous. */
export async function addImportedFile(files: Map<string, Blob>, path: string, blob: Blob): Promise<void> {
  const previous = files.get(path);
  if (previous) {
    if (previous.size !== blob.size) throw new Error(`Conflicting archive paths resolve to ${path}`);
    const [left, right] = await Promise.all([previous.arrayBuffer(), blob.arrayBuffer()]);
    const bytes = new Uint8Array(right);
    if (new Uint8Array(left).some((value, index) => value !== bytes[index]))
      throw new Error(`Conflicting archive paths resolve to ${path}`);
  } else files.set(path, blob);
}

/** Move the skills bundled by older agent exporters into the shared library. */
export async function normalizeBundledSkills(input: ReadonlyMap<string, Blob>): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();
  for (const [path, blob] of input) {
    const target = path.replace(/^agents\/[^/]+\/skills\//, "skills/");
    await addImportedFile(files, target, blob);
  }
  return files;
}

/**
 * Canonicalize validated records before writing. Returned removals belong in
 * the same transaction, so an import failure restores every previous format.
 * Transcript content remains untouched: the chat loader already migrates it
 * while keeping a recovery copy of the original transcript.
 */
export async function migrateImportedRecords(files: Map<string, Blob>): Promise<Set<string>> {
  const removals = new Set<string>();
  for (const [path, blob] of files) {
    const flat = path.match(/^chats\/([^/]+)\.json$/);
    if (!flat || flat[1] === "index") continue;
    const target = `chats/${flat[1]}/chat.json`;
    // Backups can carry both formats after a chat was saved by a newer build.
    // Prefer the archive's folder record; otherwise the flat record replaces it.
    if (!files.has(target)) files.set(target, blob);
    files.delete(path);
  }
  for (const path of files.keys()) {
    const chat = path.match(/^chats\/([^/]+)\/chat\.json$/);
    if (chat && chat[1] !== "index") removals.add(`chats/${chat[1]}.json`);
  }

  const agents = new Set(
    [...files.keys()].flatMap((path) => path.match(/^(agents\/[^/]+)\/(?:AGENTS?\.md|agent\.json)$/)?.[1] ?? []),
  );
  for (const root of agents) {
    const current = `${root}/AGENTS.md`;
    if (!files.has(current)) {
      const markdown = files.get(`${root}/AGENT.md`);
      if (markdown) files.set(current, markdown);
      else {
        const source = files.get(`${root}/agent.json`)!;
        const agent = JSON.parse(await source.text()) as Partial<Agent> & { name: string };
        // Keep unknown fields and the exact source bytes recoverable after conversion.
        if (!files.has(`${root}/agent.legacy.json`)) files.set(`${root}/agent.legacy.json`, source);
        files.set(
          current,
          new Blob([
            serializeAgentMd({
              ...agent,
              id: root.split("/")[1],
              skills: agent.skills ?? [],
              plugins: agent.plugins ?? [],
              tools: agent.tools ?? [],
              servers: agent.servers ?? [],
            }),
          ]),
        );
        // An explicit empty list clears old servers just as a populated list
        // replaces them. Missing servers still mean an unspecified partial import.
        if (agent.servers != null)
          files.set(`${root}/servers.json`, new Blob([JSON.stringify(agent.servers)], { type: "application/json" }));
      }
    }
    for (const definition of ["AGENT.md", "agent.json"]) {
      const path = `${root}/${definition}`;
      files.delete(path);
      removals.add(path);
    }
  }
  return removals;
}

/** Caller holds the agents collection lock. Older exports have no file membership index. */
export async function prepareAgentFileImport(changes: Map<string, Blob | undefined>): Promise<void> {
  const imported = new Map<string, Set<string>>();
  for (const [path, blob] of changes) {
    const file = path.match(/^(agents\/[^/]+\/files)\/([^/]+)\/metadata\.json$/);
    if (!file || !blob) continue;
    const ids = imported.get(file[1]) ?? new Set<string>();
    ids.add(file[2]);
    imported.set(file[1], ids);
  }
  for (const [root, ids] of imported) {
    const index = `${root}/index.json`;
    // An explicit archive index defines membership, including explicit deletion.
    if (changes.has(index)) continue;
    const previous = (await readJson<unknown>(index)) ?? (await listDirectories(root));
    if (!Array.isArray(previous) || previous.some((id) => typeof id !== "string"))
      throw new Error(`Invalid file index for import: ${index}`);
    changes.set(index, new Blob([JSON.stringify([...new Set([...previous, ...ids])])], { type: "application/json" }));
  }
}
