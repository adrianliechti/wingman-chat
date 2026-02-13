import { createContext } from 'react';
import type { ReactNode } from 'react';

/**
 * NavigationContext provides a way for pages to set custom actions 
 * in the left and right areas of the navigation bar.
 * 
 * Usage example:
 * ```tsx
 * const { setLeftActions, setRightActions } = useNavigation();
 * 
 * useEffect(() => {
 *   setLeftActions(<MyLeftButton />);
 *   setRightActions(<MyRightButton />);
 *   
 *   return () => {
 *     setLeftActions(null);
 *     setRightActions(null);
 *   };
 * }, []);
 * ```
 */

export type NavigationContextType = {
  leftActions: ReactNode;
  setLeftActions: (actions: ReactNode) => void;
  rightActions: ReactNode;
  setRightActions: (actions: ReactNode) => void;
};

export const NavigationContext = createContext<NavigationContextType | undefined>(undefined);
