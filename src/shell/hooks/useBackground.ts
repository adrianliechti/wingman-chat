import { useContext } from 'react';
import { BackgroundContext } from '@/shell/context/BackgroundContext';
import type { BackgroundContextValue } from '@/shell/context/BackgroundContext';

export function useBackground(): BackgroundContextValue {
  const context = useContext(BackgroundContext);
  if (context === undefined) {
    throw new Error('useBackground must be used within BackgroundProvider');
  }
  return context;
}
