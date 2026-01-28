import { useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Repository, RepositoryFile } from '../types/repository';
import * as opfs from '../lib/opfs';
import { RepositoryContext } from './RepositoryContext';
import type { RepositoryContextType } from './RepositoryContext';
import { getConfig } from '../config';

const COLLECTION = 'repositories';
const REPOSITORY_STORAGE_KEY = 'app_repository';

// Stored repository metadata (without files - they're stored separately)
interface StoredRepositoryMeta {
  id: string;
  name: string;
  embedder: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

// Stored file metadata (without text/vectors - they're stored separately)
interface StoredFileMeta {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
  uploadedAt: string;
  hasText: boolean;
  hasVectors: boolean;
  segmentCount: number;
}

// Repository-specific OPFS operations using new folder structure
// /repositories/{id}/repository.json - metadata
// /repositories/{id}/files/{fileId}/metadata.json - file metadata
// /repositories/{id}/files/{fileId}/content.txt - extracted text
// /repositories/{id}/files/{fileId}/embeddings.bin - embedding vectors as Float32Array

async function storeRepository(repo: Repository): Promise<void> {
  const repoPath = `${COLLECTION}/${repo.id}`;
  
  // Store repository metadata (without files)
  const meta: StoredRepositoryMeta = {
    id: repo.id,
    name: repo.name,
    embedder: repo.embedder,
    instructions: repo.instructions,
    createdAt: repo.createdAt instanceof Date ? repo.createdAt.toISOString() : repo.createdAt as unknown as string,
    updatedAt: repo.updatedAt instanceof Date ? repo.updatedAt.toISOString() : repo.updatedAt as unknown as string,
  };
  
  await opfs.writeJson(`${repoPath}/repository.json`, meta);
  
  // Store each file separately
  if (repo.files) {
    for (const file of repo.files) {
      await storeRepositoryFile(repo.id, file);
    }
  }
  
  // Update index
  await opfs.upsertIndexEntry(COLLECTION, {
    id: repo.id,
    title: repo.name,
    updated: meta.updatedAt,
  });
}

async function storeRepositoryFile(repoId: string, file: RepositoryFile): Promise<void> {
  const filePath = `${COLLECTION}/${repoId}/files/${file.id}`;
  
  // Store file metadata
  const meta: StoredFileMeta = {
    id: file.id,
    name: file.name,
    status: file.status,
    progress: file.progress,
    error: file.error,
    uploadedAt: file.uploadedAt instanceof Date ? file.uploadedAt.toISOString() : file.uploadedAt as unknown as string,
    hasText: !!file.text,
    hasVectors: !!(file.segments && file.segments.length > 0),
    segmentCount: file.segments?.length || 0,
  };
  
  await opfs.writeJson(`${filePath}/metadata.json`, meta);
  
  // Store text separately
  if (file.text) {
    await opfs.writeText(`${filePath}/content.txt`, file.text);
  }
  
  // Store vectors as binary (Float32Array)
  if (file.segments && file.segments.length > 0) {
    // Store segment texts as JSON array
    const segmentTexts = file.segments.map(s => s.text);
    await opfs.writeJson(`${filePath}/segments.json`, segmentTexts);
    
    // Store vectors as concatenated Float32Array
    // First element is vector dimension, rest are vectors
    const vectorDim = file.segments[0].vector.length;
    const totalFloats = 1 + file.segments.length * vectorDim;
    const buffer = new Float32Array(totalFloats);
    buffer[0] = vectorDim;
    
    let offset = 1;
    for (const segment of file.segments) {
      buffer.set(segment.vector, offset);
      offset += vectorDim;
    }
    
    const blob = new Blob([buffer.buffer], { type: 'application/octet-stream' });
    await opfs.writeBlob(`${filePath}/embeddings.bin`, blob);
  }
}

async function loadRepository(id: string): Promise<Repository | undefined> {
  const repoPath = `${COLLECTION}/${id}`;
  
  // Try new folder structure first
  const meta = await opfs.readJson<StoredRepositoryMeta>(`${repoPath}/repository.json`);
  
  // Fall back to legacy file: /repositories/{id}.json
  if (!meta) {
    const legacy = await opfs.readJson<{
      id: string;
      name: string;
      embedder: string;
      instructions?: string;
      createdAt: string;
      updatedAt: string;
      files?: RepositoryFile[];
    }>(`${COLLECTION}/${id}.json`);
    
    if (!legacy) return undefined;
    
    // Return legacy format directly (migration happens on save)
    return {
      ...legacy,
      createdAt: new Date(legacy.createdAt),
      updatedAt: new Date(legacy.updatedAt),
      files: legacy.files?.map(f => ({
        ...f,
        uploadedAt: new Date(f.uploadedAt as unknown as string),
      })),
    };
  }
  
  // Load files from subfolders
  const files: RepositoryFile[] = [];
  const fileIds = await opfs.listDirectories(`${repoPath}/files`);
  
  for (const fileId of fileIds) {
    const file = await loadRepositoryFile(id, fileId);
    if (file) {
      files.push(file);
    }
  }
  
  return {
    id: meta.id,
    name: meta.name,
    embedder: meta.embedder,
    instructions: meta.instructions,
    createdAt: new Date(meta.createdAt),
    updatedAt: new Date(meta.updatedAt),
    files: files.length > 0 ? files : undefined,
  };
}

async function loadRepositoryFile(repoId: string, fileId: string): Promise<RepositoryFile | undefined> {
  const filePath = `${COLLECTION}/${repoId}/files/${fileId}`;
  
  const meta = await opfs.readJson<StoredFileMeta>(`${filePath}/metadata.json`);
  if (!meta) return undefined;
  
  // Load text if present
  let text: string | undefined;
  if (meta.hasText) {
    text = await opfs.readText(`${filePath}/content.txt`);
  }
  
  // Load segments if present
  let segments: Array<{ text: string; vector: number[] }> | undefined;
  if (meta.hasVectors && meta.segmentCount > 0) {
    const segmentTexts = await opfs.readJson<string[]>(`${filePath}/segments.json`);
    const vectorsBlob = await opfs.readBlob(`${filePath}/embeddings.bin`);
    
    if (segmentTexts && vectorsBlob) {
      const buffer = await vectorsBlob.arrayBuffer();
      const floats = new Float32Array(buffer);
      const vectorDim = floats[0];
      
      segments = [];
      for (let i = 0; i < meta.segmentCount; i++) {
        const start = 1 + i * vectorDim;
        const vector = Array.from(floats.slice(start, start + vectorDim));
        segments.push({
          text: segmentTexts[i] || '',
          vector,
        });
      }
    }
  }
  
  return {
    id: meta.id,
    name: meta.name,
    status: meta.status,
    progress: meta.progress,
    error: meta.error,
    uploadedAt: new Date(meta.uploadedAt),
    text,
    segments,
  };
}

async function removeRepository(id: string): Promise<void> {
  // Delete entire folder (includes all files)
  await opfs.deleteDirectory(`${COLLECTION}/${id}`);
  
  // Also try to delete legacy file
  await opfs.deleteFile(`${COLLECTION}/${id}.json`);
  
  await opfs.removeIndexEntry(COLLECTION, id);
}

async function removeRepositoryFile(repoId: string, fileId: string): Promise<void> {
  await opfs.deleteDirectory(`${COLLECTION}/${repoId}/files/${fileId}`);
}

async function loadRepositoryIndex(): Promise<opfs.IndexEntry[]> {
  return opfs.readIndex(COLLECTION);
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [currentRepository, setCurrentRepository] = useState<Repository | null>(null);
  const [showRepositoryDrawer, setShowRepositoryDrawer] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Track which repositories need saving
  const pendingSaves = useRef<Set<string>>(new Set());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Keep a ref to current repositories to avoid stale closure in scheduleSave
  const repositoriesRef = useRef<Repository[]>(repositories);
  repositoriesRef.current = repositories;
  
  // Check repository availability from config (computed once on mount)
  const [isAvailable] = useState(() => {
    try {
      const config = getConfig();
      return !!config.repository;
    } catch (error) {
      console.warn('Failed to get repository config:', error);
      return false;
    }
  });

  // Load repositories from OPFS on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const index = await loadRepositoryIndex();
        const loadedRepos: Repository[] = [];
        
        for (const entry of index) {
          const repo = await loadRepository(entry.id);
          if (repo) {
            loadedRepos.push(repo);
          }
        }
        
        setRepositories(loadedRepos);
        
        // Load current repository from localStorage (simple string)
        const savedCurrentRepositoryId = localStorage.getItem(REPOSITORY_STORAGE_KEY);
        if (savedCurrentRepositoryId) {
          const foundRepository = loadedRepos.find(r => r.id === savedCurrentRepositoryId);
          if (foundRepository) {
            setCurrentRepository(foundRepository);
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

  // Debounced save function
  const scheduleSave = useCallback((repoId: string) => {
    pendingSaves.current.add(repoId);
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      const idsToSave = Array.from(pendingSaves.current);
      pendingSaves.current.clear();
      
      for (const id of idsToSave) {
        // Use ref to get current repositories to avoid stale closure
        const repo = repositoriesRef.current.find(r => r.id === id);
        if (repo) {
          try {
            await storeRepository(repo);
          } catch (error) {
            console.error(`Error saving repository ${id}:`, error);
          }
        }
      }
    }, 100);
  }, []); // No dependencies needed - uses ref for current state

  // Cleanup on unmount - flush pending saves
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Flush any pending saves
      const idsToSave = Array.from(pendingSaves.current);
      pendingSaves.current.clear();
      
      for (const id of idsToSave) {
        const repo = repositoriesRef.current.find(r => r.id === id);
        if (repo) {
          storeRepository(repo).catch(console.warn);
        }
      }
    };
  }, []);

  // Save current repository to localStorage whenever it changes
  useEffect(() => {
    if (!isLoaded) return; // Don't save during initial load
    
    if (currentRepository) {
      localStorage.setItem(REPOSITORY_STORAGE_KEY, currentRepository.id);
    } else {
      localStorage.removeItem(REPOSITORY_STORAGE_KEY);
    }
  }, [currentRepository, isLoaded]);

  const createRepository = useCallback(async (name: string, instructions?: string): Promise<Repository> => {
    const config = getConfig();

    const newRepository: Repository = {
      id: crypto.randomUUID(),
      name,

      embedder: config.repository?.embedder || '',
      
      instructions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    setRepositories(prev => [...prev, newRepository]);
    setCurrentRepository(newRepository);
    
    // Save to OPFS - await to ensure persistence before returning
    try {
      await storeRepository(newRepository);
    } catch (error) {
      console.error('Error saving new repository:', error);
    }
    
    return newRepository;
  }, []);

  const updateRepository = useCallback((id: string, updates: Partial<Omit<Repository, 'id' | 'createdAt'>>) => {
    setRepositories(prev => {
      const updated = prev.map(repo => 
        repo.id === id 
          ? { ...repo, ...updates, updatedAt: new Date() }
          : repo
      );
      
      // Schedule save
      setTimeout(() => scheduleSave(id), 0);
      
      return updated;
    });
    
    // Update current repository if it's the one being updated
    if (currentRepository?.id === id) {
      setCurrentRepository(prev => prev ? { ...prev, ...updates, updatedAt: new Date() } : null);
    }
  }, [currentRepository, scheduleSave]);

  const deleteRepository = useCallback(async (id: string) => {
    setRepositories(prev => prev.filter(repo => repo.id !== id));
    
    // Clear current repository if it's the one being deleted
    if (currentRepository?.id === id) {
      setCurrentRepository(null);
    }
    
    // Remove from OPFS
    try {
      await removeRepository(id);
    } catch (error) {
      console.error(`Error deleting repository ${id}:`, error);
    }
  }, [currentRepository]);

  // Add or update a file in a repository
  const upsertFile = useCallback((repoId: string, file: RepositoryFile) => {
    setRepositories(prev => {
      const updated = prev.map(repo => {
        if (repo.id !== repoId) return repo;
        const files = repo.files ? [...repo.files] : [];
        const existingIdx = files.findIndex(f => f.id === file.id);
        if (existingIdx !== -1) {
          files[existingIdx] = file;
        } else {
          files.push(file);
        }
        return { ...repo, files, updatedAt: new Date() };
      });
      
      // Schedule save
      setTimeout(() => scheduleSave(repoId), 0);
      
      return updated;
    });
  }, [scheduleSave]);

  // Remove a file from a repository
  const removeFile = useCallback((repoId: string, fileId: string) => {
    setRepositories(prev => {
      const updated = prev.map(repo => {
        if (repo.id !== repoId) return repo;
        const files = repo.files ? repo.files.filter(f => f.id !== fileId) : [];
        return { ...repo, files, updatedAt: new Date() };
      });
      
      // Delete file from OPFS directly
      removeRepositoryFile(repoId, fileId).catch(error => {
        console.error(`Error deleting repository file ${fileId}:`, error);
      });
      
      // Schedule save for repository metadata
      setTimeout(() => scheduleSave(repoId), 0);
      
      return updated;
    });
  }, [scheduleSave]);

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
