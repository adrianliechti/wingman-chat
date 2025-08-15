import { createContext } from 'react';
import type { Repository, RepositoryFile } from '../types/repository';

export type RepositoryContextType = {
  isAvailable: boolean;
  repositories: Repository[];
  currentRepository: Repository | null;
  createRepository: (name: string, instructions?: string) => void;
  updateRepository: (id: string, updates: Partial<Omit<Repository, 'id' | 'createdAt'>>) => void;
  deleteRepository: (id: string) => Promise<void>;
  setCurrentRepository: (repository: Repository | null) => void;
  showRepositoryDrawer: boolean;
  setShowRepositoryDrawer: (show: boolean) => void;
  toggleRepositoryDrawer: () => void;
  upsertFile: (repoId: string, file: RepositoryFile) => void;
  removeFile: (repoId: string, fileId: string) => void;
};

export const RepositoryContext = createContext<RepositoryContextType | undefined>(undefined);
