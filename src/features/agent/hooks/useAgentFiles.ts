import { useCallback } from "react";
import { getConfig } from "@/shared/config";
import type { RepositoryFile } from "@/features/repository/types/repository";
import { queryFileChunks } from "@/features/repository/lib/file-retrieval";
import { useAgents } from "./useAgents";

export type { FileChunk } from "@/features/repository/lib/file-retrieval";
export type AgentFilesHook = ReturnType<typeof useAgentFiles>;
const EMPTY_FILES: RepositoryFile[] = [];

export function useAgentFiles(agentId: string) {
  const { agents, getAgent, addFile: ingest, reindexFile: reindex, removeFile: remove } = useAgents();
  const files = agents.find((agent) => agent.id === agentId)?.files ?? EMPTY_FILES;
  const addFile = useCallback((file: File) => ingest(agentId, file), [agentId, ingest]);
  const reindexFile = useCallback((fileId: string) => reindex(agentId, fileId), [agentId, reindex]);
  const removeFile = useCallback((fileId: string) => remove(agentId, fileId), [agentId, remove]);
  const queryChunks = useCallback(
    (query: string, topK = 10, signal?: AbortSignal) =>
      queryFileChunks(
        () => getAgent(agentId)?.files ?? [],
        () => getConfig().repository?.embedder ?? "",
        (model, text, signal) => getConfig().client.embedText(model, text, { signal }),
        query,
        topK,
        signal,
      ),
    [agentId, getAgent],
  );
  return { files, addFile, reindexFile, removeFile, queryChunks };
}
