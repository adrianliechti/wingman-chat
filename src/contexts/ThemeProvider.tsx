import { useState, useEffect, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext } from './ThemeContext';
import type { Theme, ThemeContextType } from './ThemeContext';

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize theme from localStorage or system preference
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    const stored = localStorage.getItem('app_theme');
    return stored === 'light' || stored === 'dark' ? (stored as Theme) : 'system';
  });

  // Track real system preference
  const [systemPref, setSystemPref] = useState<boolean>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // Listen for system preference changes
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPref(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Determine effective dark state
  const isDark = theme === 'dark' || (theme === 'system' && systemPref);

  // Apply the class and persist explicit choices
  useLayoutEffect(() => {
    // Check if the class is already correctly set (from our blocking script)
    const currentlyDark = document.documentElement.classList.contains('dark');
    
    if (currentlyDark !== isDark) {
      document.documentElement.classList.toggle('dark', isDark);
    }
    
    if (theme === 'system') {
      localStorage.removeItem('app_theme');
    } else {
      localStorage.setItem('app_theme', theme);
    }
  }, [isDark, theme]);

  const value: ThemeContextType = {
    theme,
    setTheme,
    isDark,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
