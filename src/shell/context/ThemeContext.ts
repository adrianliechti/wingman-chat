import { createContext } from 'react';

// Support light, dark, or system preference modes
export type Theme = 'light' | 'dark' | 'system';

export type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
};

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
