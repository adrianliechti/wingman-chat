import { useContext } from 'react';
import { RepositoryContext } from '../contexts/RepositoryContext';

export function useRepositories() {
  const context = useContext(RepositoryContext);
  if (context === undefined) {
    throw new Error('useRepositories must be used within a RepositoryProvider');
  }
  return context;
}
