import { useCallback, useMemo } from 'react';
import { useRepository } from './useRepository';
import { useRepositories } from './useRepositories';
import type { Tool, ToolProvider } from '@/shared/types/chat';
import { markdownToText } from '@/shared/lib/utils';
import { createRepositoryTools } from '@/features/repository/lib/repository-tools';
import repositoryInstructions from '@/features/repository/prompts/repository.txt?raw';
import { Package } from 'lucide-react';

export function useRepositoryProvider(repositoryId: string): ToolProvider | null {
  const { files, queryChunks } = useRepository(repositoryId);
  const { repositories } = useRepositories();
  const repository = repositories.find(r => r.id === repositoryId);

  const getTools = useCallback((): Tool[] => {
    if (files.length === 0) {
      return [];
    }

    // Create all repository tools - always provide semantic search
    return createRepositoryTools(files, queryChunks);
  }, [files, queryChunks]);

  const getInstructions = useCallback((): string => {
    const instructions: string[] = [];

    // Add general repository instructions
    instructions.push(repositoryInstructions);

    // Add repository-specific instructions if present
    if (repository?.instructions?.trim()) {
      instructions.push(`## Custom Instructions

${markdownToText(repository.instructions.trim())}`);
    }

    return instructions.join('\n\n');
  }, [repository]);

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
      description: 'File access tools for your repository',
      icon: Package,
      instructions: instructions || undefined,
      tools: tools,
    };
  }, [repository, getTools, getInstructions]);

  return provider;
}
