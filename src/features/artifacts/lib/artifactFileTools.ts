import { createFileTools, type FileToolsOptions, type WritableFileSource } from "@/shared/lib/file-tools";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { artifactRevision, type ArtifactMutation } from "@/shared/types/artifact";
import type { Tool, ToolContext } from "@/shared/types/chat";
import type { AgentInvocationContext } from "@/shared/lib/agent-run-controller";
import type { ArtifactWorkspaceAccess, FileSystemManager } from "./fs";

/** Per-actor observations: another agent's reads/writes must never refresh our baseline. */
export class ArtifactReadWriteManager {
  private readonly conversations = new Map<string, Map<string, string | undefined>>();
  private readonly children = new WeakMap<AgentInvocationContext, Map<string, Map<string, string | undefined>>>();

  private session(chatId: string, context?: ToolContext): Map<string, string | undefined> {
    // Child observations live only as long as their existing invocation object.
    // Many child runs must not evict the active conversation's baseline.
    const invocation = context?.invocationContext;
    let sessions = this.conversations;
    if (invocation?.branch) {
      sessions = this.children.get(invocation) ?? new Map();
      this.children.set(invocation, sessions);
    }
    const seen = sessions.get(chatId) ?? new Map<string, string | undefined>();
    sessions.delete(chatId);
    sessions.set(chatId, seen);
    if (sessions.size > 64) sessions.delete(sessions.keys().next().value!);
    return seen;
  }

  private async revision(access: ArtifactWorkspaceAccess, path: string): Promise<string | undefined> {
    const file = await access.getFile(path);
    return file ? artifactRevision(file.content, file.contentType) : undefined;
  }

  async record(
    access: ArtifactWorkspaceAccess,
    chatId: string,
    context: ToolContext | undefined,
    mutations: ArtifactMutation[],
  ) {
    const seen = this.session(chatId, context);
    for (const mutation of mutations) {
      if (mutation.from) seen.set(mutation.from, undefined);
      // OPFS may infer a different MIME type when reading back stored bytes;
      // observe that canonical state instead of trusting the pre-write revision.
      seen.set(mutation.path, mutation.operation === "delete" ? undefined : await this.revision(access, mutation.path));
    }
  }

  createTools(getFs: (context?: ToolContext) => FileSystemManager | null, options: FileToolsOptions): Tool[] {
    const requireFs = (context?: ToolContext) => {
      const fs = getFs(context);
      if (!fs) throw new Error("File system not available");
      return fs;
    };
    // Only the schemas/presentation escape; each invocation binds one locked workspace.
    return createFileTools(this.source(requireFs), options).map((definition) => ({
      ...definition,
      function: async (args, context) => {
        const fs = requireFs(context);
        return fs.withExclusiveAccess(async (access) => {
          context?.signal?.throwIfAborted();
          const seen = this.session(fs.chatId, context);
          const source = this.source(() => access);
          const read = source.read.bind(source);
          if (definition.name === `${options.namespace}_read`) {
            source.read = async (path) => {
              const file = await read(path);
              const normalized = normalizeArtifactPath(path);
              if (normalized)
                seen.set(normalized, file ? await artifactRevision(file.content, file.contentType) : undefined);
              return file;
            };
          }
          const assertFresh = async (paths: readonly string[]) => {
            for (const path of paths) {
              const normalized = normalizeArtifactPath(path);
              if (!normalized) continue;
              // Include tracked descendants when deleting/moving a folder.
              for (const [tracked, revision] of seen) {
                if (tracked !== normalized && !tracked.startsWith(`${normalized}/`)) continue;
                if (revision !== (await this.revision(access, tracked))) {
                  throw new Error(
                    `${tracked} changed since you last read or wrote it. Use ${options.namespace}_read and retry with the current content.`,
                  );
                }
              }
            }
            context?.signal?.throwIfAborted();
          };
          const write = source.write.bind(source);
          source.write = async (path, content, type) => {
            await assertFresh([path]);
            const mutations = await write(path, content, type);
            await this.record(access, fs.chatId, context, mutations ?? []);
            return mutations;
          };
          const writeBatch = source.writeBatch.bind(source);
          source.writeBatch = async (files) => {
            await assertFresh(files.map((file) => file.path));
            const mutations = await writeBatch(files);
            await this.record(access, fs.chatId, context, mutations ?? []);
            return mutations;
          };
          const remove = source.remove.bind(source);
          source.remove = async (path) => {
            await assertFresh([path]);
            const mutations = await remove(path);
            if (Array.isArray(mutations)) await this.record(access, fs.chatId, context, mutations);
            return mutations;
          };
          const move = source.move.bind(source);
          source.move = async (from, to) => {
            await assertFresh([from, to]);
            const mutations = await move(from, to);
            if (Array.isArray(mutations)) await this.record(access, fs.chatId, context, mutations);
            return mutations;
          };
          const tool = createFileTools(source, options).find((candidate) => candidate.name === definition.name)!;
          return tool.function(args, context);
        });
      },
    }));
  }

  private source(getAccess: () => ArtifactWorkspaceAccess): WritableFileSource {
    return {
      list: () => getAccess().listEntries(),
      read: (path) => getAccess().getFile(path),
      write: async (path, content, contentType) =>
        (
          await getAccess().applyOverlayDelta({
            upserts: { [path]: { content, contentType } },
            deletes: [],
          })
        ).mutations,
      writeBatch: async (files) =>
        (
          await getAccess().applyOverlayDelta({
            upserts: Object.fromEntries(
              files.map((file) => [file.path, { content: file.content, contentType: file.contentType }]),
            ),
            deletes: [],
          })
        ).mutations,
      remove: async (path) => (await getAccess().applyOverlayDelta({ upserts: {}, deletes: [path] })).mutations,
      move: (from, to) => getAccess().renameFileWithDelta(from, to),
    };
  }
}
