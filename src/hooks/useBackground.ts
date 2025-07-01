import { useContext } from 'react';
import { BackgroundContext, BackgroundContextValue } from '../contexts/BackgroundContext';

/**
 * Hook to access background settings and current wallpaper.
 * Must be used within a BackgroundProvider.
 */
export function useBackground(): BackgroundContextValue {
  const context = useContext(BackgroundContext);
  if (!context) {
    throw new Error('useBackground must be used within BackgroundProvider');
  }
  return context;
}
