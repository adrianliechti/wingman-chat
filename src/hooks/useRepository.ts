import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import pLimit from 'p-limit';
import { Client } from '../lib/client';
import { VectorDB, Document } from '../lib/vectordb';
import { Tool } from '../types/chat';
import { RepositoryFile } from '../types/repository';
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
}

// Shared client instance for all repositories
const client = new Client();

export function useRepository(repositoryId: string): RepositoryHook {
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
      console.error('Search failed:', error);
      return [];
    }
  }, [vectorDB, repositoryId, repository?.embedder, files]);

  const queryTools = useCallback((): Tool[] => {
    if (files.length === 0) {
      return [];
    }
    
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
          console.log(`🔍 find_documents tool invoked with query: "${query}"`);
          
          if (!query) {
            console.log('❌ No query provided');
            return JSON.stringify({ error: 'No query provided' });
          }

          try {
            const results = await queryChunks(query, 5);
            console.log(`📊 Query results: ${results.length} chunks found`);
            
            if (results.length === 0) {
              console.log('📭 No relevant documents found');
              return JSON.stringify([]);
            }

            const jsonResults = results.map((result, index) => {
              console.log(`📄 Result ${index + 1}:`);
              console.log(`   File: ${result.file.name}`);
              console.log(`   Similarity: ${(result.similarity || 0).toFixed(3)}`);
              console.log(`   Text preview: ${result.text.substring(0, 100)}...`);
              
              return {
                file_name: result.file.name,
                file_chunk: result.text,
                similarity: result.similarity || 0
              };
            });

            console.log(`✅ Returning ${jsonResults.length} document chunks`);
            return JSON.stringify(jsonResults);
          } catch (error) {
            console.error('❌ Repository knowledge query failed:', error);
            return JSON.stringify({ error: 'Failed to query repository knowledge database' });
          }
        }
      }
    ];
  }, [queryChunks, files.length]);

  return {
    files,
    removeFile,
    addFile,
    queryChunks,
    queryTools,
  };
}
