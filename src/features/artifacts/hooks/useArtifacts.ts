import { useContext } from 'react';
import { ArtifactsContext } from '@/features/artifacts/context/ArtifactsContext';
import type { ArtifactsContextType } from '@/features/artifacts/context/ArtifactsContext';

export function useArtifacts(): ArtifactsContextType {
  const context = useContext(ArtifactsContext);
  
  if (!context) {
    throw new Error('useArtifacts must be used within an ArtifactsProvider');
  }

  return context;
}
