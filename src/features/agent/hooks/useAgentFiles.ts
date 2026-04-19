import pLimit from "p-limit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Document } from "@/features/repository/lib/vectordb";
import { VectorDB } from "@/features/repository/lib/vectordb";
import type { RepositoryFile } from "@/features/repository/types/repository";
import { getConfig } from "@/shared/config";
import { Client } from "@/shared/lib/client";
import { convertFileToText } from "@/shared/lib/convert";
import { useAgents } from "./useAgents";

export interface FileChunk {
  file: RepositoryFile;
  text: string;
  similarity?: number;
}

export interface AgentFilesHook {
  files: RepositoryFile[];
  addFile: (file: File) => Promise<void>;
  removeFile: (fileId: string) => void;
  queryChunks: (query: string, topK?: number) => Promise<FileChunk[]>;
}

// Shared client instance
const client = new Client();

export function useAgentFiles(agentId: string): AgentFilesHook {
  const { agents, upsertFile, removeFile: removeFileFromAgent } = useAgents();
  const [vectorDB, setVectorDB] = useState(() => new VectorDB());
  const currentAgentIdRef = useRef(agentId);
  const agentsRef = useRef(agents);

  useEffect(() => {
    currentAgentIdRef.current = agentId;
  }, [agentId]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const agent = agents.find((a) => a.id === agentId);
  const files = useMemo(() => agent?.files || [], [agent?.files]);

  // Rebuild vector database when files change
  useEffect(() => {
    let isCancelled = false;

    const rebuildVectorDB = () => {
      setVectorDB(new VectorDB());

      if (files.length > 0) {
        const newVectorDB = new VectorDB();
        files.forEach((file) => {
          if (file.segments) {
            file.segments.forEach((segment, index) => {
              const chunkDoc: Document = {
                id: `${agentId}:${file.id}:${index}`,
                text: segment.text,
                source: file.name,
                vector: segment.vector,
              };
              newVectorDB.addDocument(chunkDoc);
            });
          }
        });

        if (!isCancelled) {
          setVectorDB(newVectorDB);
        }
      }
    };

    rebuildVectorDB();

    return () => {
      isCancelled = true;
    };
  }, [agentId, files]);

  const removeFile = useCallback(
    (fileId: string) => {
      const currentId = currentAgentIdRef.current;

      const fileToRemove = files.find((f) => f.id === fileId);
      if (fileToRemove?.segments) {
        for (let i = 0; i < fileToRemove.segments.length; i++) {
          const documentId = `${currentId}:${fileId}:${i}`;
          vectorDB.deleteDocument(documentId);
        }
      }

      removeFileFromAgent(agentId, fileId);
    },
    [vectorDB, agentId, removeFileFromAgent, files],
  );

  const processFile = useCallback(
    async (file: File, fileId: string) => {
      const currentId = currentAgentIdRef.current;

      const text = await convertFileToText(file);
      if (currentAgentIdRef.current !== currentId) return;

      const currentAgent = agentsRef.current.find((a) => a.id === currentId);
      if (!currentAgent?.files?.find((f) => f.id === fileId)) return;

      upsertFile(agentId, {
        id: fileId,
        name: file.name,
        status: "processing",
        progress: 10,
        text,
        uploadedAt: new Date(),
      });

      const segments = await client.segmentText(file);
      if (currentAgentIdRef.current !== currentId) return;

      const currentAgent2 = agentsRef.current.find((a) => a.id === currentId);
      if (!currentAgent2?.files?.find((f) => f.id === fileId)) return;

      upsertFile(agentId, {
        id: fileId,
        name: file.name,
        status: "processing",
        progress: 20,
        text,
        uploadedAt: new Date(),
      });

      const limit = pLimit(10);
      const model = getConfig().repository?.embedder ?? "";

      let completedCount = 0;

      const chunks = await Promise.all(
        segments.map((segment) =>
          limit(async () => {
            const vector = await client.embedText(model, segment);
            completedCount++;

            if (currentAgentIdRef.current !== currentId) return { text: segment, vector };

            const currentAgent3 = agentsRef.current.find((a) => a.id === currentId);
            if (!currentAgent3?.files?.find((f) => f.id === fileId)) return { text: segment, vector };

            const progress = 20 + (completedCount / segments.length) * 80;
            upsertFile(agentId, {
              id: fileId,
              name: file.name,
              status: "processing",
              progress: Math.round(progress),
              text,
              uploadedAt: new Date(),
            });

            return { text: segment, vector };
          }),
        ),
      );

      if (currentAgentIdRef.current !== currentId) return;

      const currentAgent4 = agentsRef.current.find((a) => a.id === currentId);
      if (!currentAgent4?.files?.find((f) => f.id === fileId)) return;

      chunks.forEach((chunk, index) => {
        const chunkDoc: Document = {
          id: `${currentId}:${fileId}:${index}`,
          text: chunk.text,
          source: file.name,
          vector: chunk.vector,
        };
        vectorDB.addDocument(chunkDoc);
      });

      upsertFile(agentId, {
        id: fileId,
        name: file.name,
        status: "completed",
        progress: 100,
        text,
        segments: chunks,
        uploadedAt: new Date(),
      });
    },
    [upsertFile, agentId, vectorDB],
  );

  const addFile = useCallback(
    async (file: File) => {
      const fileId = crypto.randomUUID();
      const currentId = currentAgentIdRef.current;

      upsertFile(agentId, {
        id: fileId,
        name: file.name,
        status: "processing",
        progress: 0,
        uploadedAt: new Date(),
      });

      try {
        await processFile(file, fileId);
      } catch (error) {
        if (currentAgentIdRef.current === currentId) {
          upsertFile(agentId, {
            id: fileId,
            name: file.name,
            status: "error",
            progress: 0,
            error: error instanceof Error ? error.message : "Processing failed",
            uploadedAt: new Date(),
          });
        }
      }
    },
    [processFile, agentId, upsertFile],
  );

  const queryChunks = useCallback(
    async (query: string, topK: number = 10): Promise<FileChunk[]> => {
      if (!query.trim()) return [];

      try {
        const model = getConfig().repository?.embedder ?? "";
        const vector = await client.embedText(model, query);
        const results = vectorDB.queryDocuments(vector, topK);

        return results
          .filter((result) => result.document.id.startsWith(`${agentId}:`))
          .flatMap((result) => {
            const parts = result.document.id.split(":");
            const fileId = parts[1];
            const file = files.find((f) => f.id === fileId);

            if (!file) {
              return [];
            }

            return [
              {
                file,
                text: result.document.text,
                similarity: result.similarity,
              },
            ];
          });
      } catch (error) {
        console.error("[agent] Search failed", { query, agentId, error });
        return [];
      }
    },
    [vectorDB, agentId, files],
  );

  return {
    files,
    removeFile,
    addFile,
    queryChunks,
  };
}
