import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavigationContext } from './NavigationContext';
import type { NavigationContextType } from './NavigationContext';

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [leftActions, setLeftActions] = useState<ReactNode>(null);
  const [rightActions, setRightActions] = useState<ReactNode>(null);

  const value: NavigationContextType = {
    leftActions,
    setLeftActions,
    rightActions,
    setRightActions,
  };

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
