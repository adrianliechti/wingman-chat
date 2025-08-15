import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Repository, RepositoryFile } from '../types/repository';
import { setValue, getValue } from '../lib/db';
import { RepositoryContext } from './RepositoryContext';
import type { RepositoryContextType } from './RepositoryContext';
import { getConfig } from '../config';

const REPOSITORIES_DB_KEY = 'repositories';
const REPOSITORY_STORAGE_KEY = 'app_repository';

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [currentRepository, setCurrentRepository] = useState<Repository | null>(null);
  const [showRepositoryDrawer, setShowRepositoryDrawer] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  // Check repository availability from config
  useEffect(() => {
    try {
      const config = getConfig();
      setIsAvailable(config.repository.enabled);
    } catch (error) {
      console.warn('Failed to get repository config:', error);
      setIsAvailable(false);
    }
  }, []);

  // Load repositories from database and state from localStorage on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load repositories from database
        const savedRepositories = await getValue<Repository[]>(REPOSITORIES_DB_KEY);
        
        if (savedRepositories) {
          // Parse dates from stored data
          const repositoriesWithDates = savedRepositories.map(repo => ({
            ...repo,
            createdAt: new Date(repo.createdAt),
            updatedAt: new Date(repo.updatedAt),
          }));
          
          setRepositories(repositoriesWithDates);
          
          // Load current repository from localStorage (simple string)
          const savedCurrentRepositoryId = localStorage.getItem(REPOSITORY_STORAGE_KEY);
          if (savedCurrentRepositoryId) {
            const foundRepository = repositoriesWithDates.find(r => r.id === savedCurrentRepositoryId);
            if (foundRepository) {
              setCurrentRepository(foundRepository);
            }
          }
        }

      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadData();
  }, []);

  // Save repositories to database whenever they change
  useEffect(() => {
    if (!isLoaded) return; // Don't save during initial load
    
    const saveRepositories = async () => {
      try {
        await setValue(REPOSITORIES_DB_KEY, repositories);
      } catch (error) {
        console.error('Failed to save repositories to database:', error);
      }
    };

    saveRepositories();
  }, [repositories, isLoaded]);

  // Save current repository to localStorage whenever it changes
  useEffect(() => {
    if (!isLoaded) return; // Don't save during initial load
    
    if (currentRepository) {
      localStorage.setItem(REPOSITORY_STORAGE_KEY, currentRepository.id);
    } else {
      localStorage.removeItem(REPOSITORY_STORAGE_KEY);
    }
  }, [currentRepository, isLoaded]);

  const createRepository = useCallback((name: string, instructions?: string) => {
    const config = getConfig();

    const newRepository: Repository = {
      id: crypto.randomUUID(),
      name,

      embedder: config.repository.embedder || '',
      
      instructions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    setRepositories(prev => [...prev, newRepository]);
    setCurrentRepository(newRepository);
  }, []);

  const updateRepository = useCallback((id: string, updates: Partial<Omit<Repository, 'id' | 'createdAt'>>) => {
    setRepositories(prev => prev.map(repo => 
      repo.id === id 
        ? { ...repo, ...updates, updatedAt: new Date() }
        : repo
    ));
    
    // Update current repository if it's the one being updated
    if (currentRepository?.id === id) {
      setCurrentRepository(prev => prev ? { ...prev, ...updates, updatedAt: new Date() } : null);
    }
  }, [currentRepository]);

  const deleteRepository = useCallback(async (id: string) => {
    setRepositories(prev => prev.filter(repo => repo.id !== id));
    
    // Clear current repository if it's the one being deleted
    if (currentRepository?.id === id) {
      setCurrentRepository(null);
    }
  }, [currentRepository]);

  // Add or update a file in a repository
  const upsertFile = useCallback((repoId: string, file: RepositoryFile) => {
    setRepositories(prev => prev.map(repo => {
      if (repo.id !== repoId) return repo;
      const files = repo.files ? [...repo.files] : [];
      const existingIdx = files.findIndex(f => f.id === file.id);
      if (existingIdx !== -1) {
        files[existingIdx] = file;
      } else {
        files.push(file);
      }
      return { ...repo, files, updatedAt: new Date() };
    }));
  }, []);

  // Remove a file from a repository
  const removeFile = useCallback((repoId: string, fileId: string) => {
    setRepositories(prev => prev.map(repo => {
      if (repo.id !== repoId) return repo;
      const files = repo.files ? repo.files.filter(f => f.id !== fileId) : [];
      return { ...repo, files, updatedAt: new Date() };
    }));
  }, []);

  // Toggle repository drawer
  const toggleRepositoryDrawer = useCallback(() => {
    setShowRepositoryDrawer(prev => !prev);
  }, []);

  const value: RepositoryContextType = {
    isAvailable,
    repositories,
    currentRepository,
    createRepository,
    updateRepository,
    deleteRepository,
    setCurrentRepository,
    showRepositoryDrawer,
    setShowRepositoryDrawer,
    toggleRepositoryDrawer,
    upsertFile,
    removeFile,
  };

  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}
