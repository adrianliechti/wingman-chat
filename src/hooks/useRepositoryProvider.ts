import { useCallback, useMemo } from 'react';
import { useRepository } from './useRepository';
import { useRepositories } from './useRepositories';
import type { Tool, ToolProvider } from '../types/chat';
import { markdownToText } from '../lib/utils';
import repositoryRagInstructions from '../prompts/repository-rag.txt?raw';
import repositoryContextInstructions from '../prompts/repository-context.txt?raw';
import { Package } from 'lucide-react';

export function useRepositoryProvider(repositoryId: string, mode: 'auto' | 'rag' | 'context' = 'auto'): ToolProvider | null {
  const { files, queryChunks, useRAG } = useRepository(repositoryId, mode);
  const { repositories } = useRepositories();
  const repository = repositories.find(r => r.id === repositoryId);

  const getTools = useCallback((): Tool[] => {
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

            if (!query) {
              return JSON.stringify({ error: 'No query provided' });
            }

            try {
              const results = await queryChunks(query, 5);

              if (results.length === 0) {
                return JSON.stringify([]);
              }

              const jsonResults = results.map((result) => {
                return {
                  file_name: result.file.name,
                  file_chunk: result.text,
                  similarity: result.similarity || 0
                };
              });

              return JSON.stringify(jsonResults);
            } catch {
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

  const getInstructions = useCallback((): string => {
    const instructions = [];

    if (repository?.instructions?.trim()) {
      instructions.push(`
## Instructions

Follow the instructions below carefully:

${markdownToText(repository.instructions.trim())}
`.trim());
    }

    if (useRAG) {
      instructions.push(repositoryRagInstructions);
    } else {
      instructions.push(repositoryContextInstructions);

      // Include full content of every file (no truncation)
      for (const file of files) {
        if (!file.text || !file.text.trim()) continue;
        instructions.push(`\n\n\`\`\`text ${file.name}\n${file.text}\n\`\`\``);
      }
    }

    return instructions.join('\n\n');
  }, [repository, useRAG, files]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!repository) {
      return null;
    }

    const tools = getTools();
    const instructions = getInstructions();

    // If no tools and no instructions, return null
    if (tools.length === 0 && !instructions.trim()) {
      return null;
    }

    return {
      id: 'repository',
      name: 'Repository',
      description: 'Include your files',
      icon: Package,
      instructions: instructions || undefined,
      tools: tools,
    };
  }, [repository, getTools, getInstructions]);

  return provider;
}
