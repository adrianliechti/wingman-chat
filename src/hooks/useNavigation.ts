import { useContext } from 'react';
import { NavigationContext } from '../contexts/NavigationContext';
import type { NavigationContextType } from '../contexts/NavigationContext';

export function useNavigation(): NavigationContextType {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}
