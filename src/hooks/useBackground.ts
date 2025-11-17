import { useContext } from 'react';
import { BackgroundContext } from '../contexts/BackgroundContext';
import type { BackgroundContextValue } from '../contexts/BackgroundContext';

export function useBackground(): BackgroundContextValue {
  const context = useContext(BackgroundContext);
  if (context === undefined) {
    throw new Error('useBackground must be used within BackgroundProvider');
  }
  return context;
}
