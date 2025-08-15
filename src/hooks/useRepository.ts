import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import pLimit from 'p-limit';
import { Client } from '../lib/client';
import { VectorDB } from '../lib/vectordb';
import type { Document } from '../lib/vectordb';
import type { Tool } from '../types/chat';
import type { RepositoryFile } from '../types/repository';
import { useRepositories } from './useRepositories';

export interface FileChunk {
  file: RepositoryFile;

  text: string;
  similarity?: number;
}

export interface RepositoryHook {
  files: RepositoryFile[];
  addFile: (file: File) => Promise<void>;
  removeFile: (fileId: string) => void;
  queryChunks: (query: string, topK?: number) => Promise<FileChunk[]>;
  queryTools: () => Tool[];
  queryInstructions: () => string;
  useRAG: boolean;
  totalPages: number;
  totalCharacters: number;
}

// Shared client instance for all repositories
const client = new Client();

export function useRepository(repositoryId: string, mode: 'auto' | 'rag' | 'context' = 'auto'): RepositoryHook {
  const { repositories, upsertFile, removeFile: removeFileFromRepo } = useRepositories();
  const [vectorDB, setVectorDB] = useState(() => new VectorDB());
  const currentRepositoryIdRef = useRef(repositoryId);
  const repositoriesRef = useRef(repositories);

  // Update refs whenever values change
  useEffect(() => {
    currentRepositoryIdRef.current = repositoryId;
  }, [repositoryId]);

  useEffect(() => {
    repositoriesRef.current = repositories;
  }, [repositories]);

  // Get files from the current repository
  const repository = repositories.find(r => r.id === repositoryId);
  const files = useMemo(() => repository?.files || [], [repository?.files]);

  // Calculate total text length for mode selection
  const totalCharacters = useMemo(() => {
    return files.reduce((total, file) => {
      return total + (file.text?.length || 0);
    }, 0);
  }, [files]);

  // Calculate total pages (approximately 1800 characters per page)
  const totalPages = useMemo(() => {
    return totalCharacters / 1800;
  }, [totalCharacters]);

  // Determine if we should use RAG mode (true) or full content mode (false)
  const useRAG = useMemo(() => {
    if (mode === 'rag') return true;
    if (mode === 'context') return false;
    // auto mode: determine based on repository size
    return totalPages > 150;
  }, [mode, totalPages]);

  // Handle repository changes and rebuild vector database
  useEffect(() => {
    let isCancelled = false;

    const rebuildVectorDB = () => {
      // Immediately clear current vector DB
      setVectorDB(new VectorDB());

      if (files.length > 0) {
        // Rebuild vector database for this repository
        const newVectorDB = new VectorDB();
        files.forEach(file => {
          if (file.segments) {
            file.segments.forEach((segment, index) => {
              const chunkDoc: Document = {
                id: `${repositoryId}:${file.id}:${index}`,
                text: segment.text,
                source: file.name,
                vector: segment.vector
              };
              newVectorDB.addDocument(chunkDoc);
            });
          }
        });

        // Only update state if this effect hasn't been cancelled
        if (!isCancelled) {
          setVectorDB(newVectorDB);
        }
      }
    };

    rebuildVectorDB();

    // Cleanup function to cancel this effect if repositoryId changes
    return () => {
      isCancelled = true;
    };
  }, [repositoryId, files]);

  const removeFile = useCallback((fileId: string) => {
    // Remove documents from vector database for this file
    const currentRepoId = currentRepositoryIdRef.current;

    // Find the file being removed to get its segments count
    const fileToRemove = files.find(f => f.id === fileId);
    if (fileToRemove && fileToRemove.segments) {
      // Remove all segments for this file from vector database
      for (let i = 0; i < fileToRemove.segments.length; i++) {
        const documentId = `${currentRepoId}:${fileId}:${i}`;
        vectorDB.deleteDocument(documentId);
      }
    }

    // Remove from repository
    removeFileFromRepo(repositoryId, fileId);
  }, [vectorDB, repositoryId, removeFileFromRepo, files]);

  const processFile = useCallback(async (file: File, fileId: string) => {
    const currentRepoId = currentRepositoryIdRef.current;

    // Convert File to Blob for storage
    const content = new Blob([file], { type: file.type });

    // Extract text
    const text = await client.extractText(file);
    // Check if repository changed or file was removed during processing
    if (currentRepositoryIdRef.current !== currentRepoId) return;

    // Check if file still exists in repository (might have been deleted)
    const currentRepo = repositoriesRef.current.find(r => r.id === currentRepoId);
    if (!currentRepo?.files?.find(f => f.id === fileId)) return;

    upsertFile(repositoryId, {
      id: fileId,
      name: file.name,
      content,
      status: 'processing',
      progress: 10,
      text,
      uploadedAt: new Date(),
    });

    // Segment text
    const segments = await client.segmentText(file);
    // Check if repository changed or file was removed during processing
    if (currentRepositoryIdRef.current !== currentRepoId) return;

    // Check if file still exists in repository (might have been deleted)
    const currentRepo2 = repositoriesRef.current.find(r => r.id === currentRepoId);
    if (!currentRepo2?.files?.find(f => f.id === fileId)) return;

    upsertFile(repositoryId, {
      id: fileId,
      name: file.name,
      content,
      status: 'processing',
      progress: 20,
      text,
      uploadedAt: new Date(),
    });

    // Embed segments with progress tracking
    const limit = pLimit(10);
    const model = repository?.embedder ?? '';

    let completedCount = 0;

    const chunks = await Promise.all(
      segments.map(segment =>
        limit(async () => {
          const vector = await client.embedText(model, segment);
          completedCount++;

          // Check if repository changed or file was removed during processing
          if (currentRepositoryIdRef.current !== currentRepoId) return { text: segment, vector };

          // Check if file still exists in repository (might have been deleted)
          const currentRepo3 = repositoriesRef.current.find(r => r.id === currentRepoId);
          if (!currentRepo3?.files?.find(f => f.id === fileId)) return { text: segment, vector };

          const progress = 20 + (completedCount / segments.length) * 80;
          upsertFile(repositoryId, {
            id: fileId,
            name: file.name,
            content,
            status: 'processing',
            progress: Math.round(progress),
            text,
            uploadedAt: new Date(),
          });

          return { text: segment, vector };
        })
      )
    );

    // Final check before storing results
    if (currentRepositoryIdRef.current !== currentRepoId) return;

    // Check if file still exists in repository (might have been deleted)
    const currentRepo4 = repositoriesRef.current.find(r => r.id === currentRepoId);
    if (!currentRepo4?.files?.find(f => f.id === fileId)) return;

    // Store in vector database
    chunks.forEach((chunk, index) => {
      const chunkDoc: Document = {
        id: `${currentRepoId}:${fileId}:${index}`,
        text: chunk.text,
        source: file.name,
        vector: chunk.vector
      };
      vectorDB.addDocument(chunkDoc);
    });

    // Mark as completed
    upsertFile(repositoryId, {
      id: fileId,
      name: file.name,
      content,
      status: 'completed',
      progress: 100,
      text,
      segments: chunks,
      uploadedAt: new Date(),
    });
  }, [upsertFile, repositoryId, repository?.embedder, vectorDB]);

  const addFile = useCallback(async (file: File) => {
    const fileId = crypto.randomUUID();
    const currentRepoId = currentRepositoryIdRef.current;

    // Convert File to Blob for storage
    const content = new Blob([file], { type: file.type });

    // Add file to repository as processing
    upsertFile(repositoryId, {
      id: fileId,
      name: file.name,
      content,
      status: 'processing',
      progress: 0,
      uploadedAt: new Date(),
    });

    try {
      await processFile(file, fileId);
    } catch (error) {
      // Only update error state if we're still on the same repository
      if (currentRepositoryIdRef.current === currentRepoId) {
        upsertFile(repositoryId, {
          id: fileId,
          name: file.name,
          content,
          status: 'error',
          progress: 0,
          error: error instanceof Error ? error.message : 'Processing failed',
          uploadedAt: new Date(),
        });
      }
    }
  }, [processFile, repositoryId, upsertFile]);

  const queryChunks = useCallback(async (query: string, topK: number = 10): Promise<FileChunk[]> => {
    if (!query.trim()) return [];

    try {
      const model = repository?.embedder ?? '';
      const vector = await client.embedText(model, query);
      const results = vectorDB.queryDocuments(vector, topK);

      // Filter and convert results
      return results
        .filter(result => result.document.id.startsWith(`${repositoryId}:`))
        .map(result => {
          const parts = result.document.id.split(':');

          const fileId = parts[1];
          const file = files.find(f => f.id === fileId);

          return {
            file: file!,
            text: result.document.text,
            similarity: result.similarity
          };
        })
        .filter(chunk => chunk.file);
    } catch (error) {
      console.error("[repository] Search failed", { query, repositoryId, error });
      return [];
    }
  }, [vectorDB, repositoryId, repository?.embedder, files]);

  const queryTools = useCallback((): Tool[] => {
    if (files.length === 0) {
      return [];
    }

    if (useRAG) {
      // Large repository: use RAG with vector search
      return [
        {
          name: 'query_knowledge_database',
          description: 'Search and retrieve information from a knowledge database using natural language queries. Returns relevant documents, facts, or answers based on the search criteria.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: `The search query or question to find relevant information in the knowledge database. Use natural language and be specific about what information you're looking for.`
              }
            },
            required: ['query']
          },
          function: async (args: Record<string, unknown>): Promise<string> => {
            const query = args.query as string;
            console.log("[repository] Query", { query });

            if (!query) {
              console.log("[repository] Query failed - no query provided");
              return JSON.stringify({ error: 'No query provided' });
            }

            try {
              const results = await queryChunks(query, 5);
              console.log("[repository] Query completed", { query, resultsCount: results.length });

              if (results.length === 0) {
                console.log("[repository] No relevant documents found", { query });
                return JSON.stringify([]);
              }

              const jsonResults = results.map((result, index) => {
                console.log("[repository] Processing result", { 
                  index: index + 1, 
                  fileName: result.file.name, 
                  similarity: (result.similarity || 0).toFixed(3),
                  textPreview: result.text.substring(0, 100) + "..."
                });

                return {
                  file_name: result.file.name,
                  file_chunk: result.text,
                  similarity: result.similarity || 0
                };
              });

              console.log("[repository] Returning results", { count: jsonResults.length });
              return JSON.stringify(jsonResults);
            } catch (error) {
              console.error("[repository] Query failed", { query, error });
              return JSON.stringify({ error: 'Failed to query repository' });
            }
          }
        }
      ];
    } else {
  // Small repository: no retrieval tool; content injected directly into system prompt
  return [];
    }
  }, [queryChunks, files, useRAG]);

  const queryInstructions = useCallback((): string => {
    const instructions = [];

    if (repository?.instructions?.trim()) {
      instructions.push(`
## Instructions

\`\`\`\`text
${repository.instructions.trim()}
\`\`\`\`
`.trim());
    }

    if (files.length > 0) {
      if (useRAG) {
        instructions.push(`
## Personal RAG Knowledge Database

You have access to a personal knowledge database containing the user's uploaded documents. This is a Retrieval-Augmented Generation (RAG) system that allows you to search and retrieve specific information from their files.

### Best Practices:
1. For *every* user query, you MUST first invoke the \`query_knowledge_database\` tool with a concise, natural-language query.
2. Examine the tool's results.
   - If you get ≥1 relevant documents or facts, answer the user *solely* using those results.
   - Include source citations (e.g. doc IDs, relevance scores, or text snippets).
3. Only if the tool returns no relevant information, you may answer from general knowledge—but still note "no document match; using fallback knowledge".
4. If the tool call fails, report the failure and either retry or ask the user to clarify.
5. Be concise, accurate, and transparent about sources.

Use GitHub Flavored Markdown to format your responses including tables, code blocks, links, and lists.
`.trim());
      } else {
        instructions.push(`
## Personal Knowledge Base

You have full access to the user's uploaded documents. Because the total size is below the RAG threshold, ALL file contents have been embedded directly below in this system prompt. No retrieval tool call is required.

### Best Practices:
1. Answer using ONLY the provided file contents below when possible; cite file names and (if helpful) short indicative snippets.
2. If the answer cannot be found in these files, explicitly state that the repository lacks the required information before using general knowledge.
3. Keep answers concise but complete. Prefer citing fewer, most relevant passages over many loosely related ones.
4. When referencing code, quote only the necessary lines; avoid large irrelevant blocks.

### Provided Files
The following section lists each file wrapped in a fenced block. Treat this as authoritative context.
`.trim());

        // Include full content of every file (no truncation)
        for (const file of files) {
          if (!file.text || !file.text.trim()) continue;
          instructions.push(`\n\n\`\`\`text ${file.name}\n${file.text}\n\`\`\``);
        }
      }
    }

    return instructions.join('\n\n');
  }, [repository?.instructions, useRAG, files]);

  return {
    files,
    removeFile,
    addFile,
    queryChunks,
    queryTools,
    queryInstructions,
    useRAG,
    totalPages,
    totalCharacters,
  };
}