import { createContext } from 'react';

export type LayoutMode = 'normal' | 'wide';

export type LayoutContextType = {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
};

export const LayoutContext = createContext<LayoutContextType | undefined>(undefined);
