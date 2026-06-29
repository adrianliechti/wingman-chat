import type { ReactNode } from "react";
import { useLayoutEffect, useState } from "react";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import type { Theme, ThemeContextType } from "./ThemeContext";
import { ThemeContext } from "./ThemeContext";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize theme from localStorage or system preference
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    const stored = localStorage.getItem("app_theme");
    return stored === "light" || stored === "dark" ? (stored as Theme) : "system";
  });

  // Track real system preference
  const systemPref = useMediaQuery("(prefers-color-scheme: dark)");

  // Determine effective dark state
  const isDark = theme === "dark" || (theme === "system" && systemPref);

  // Apply the class and persist explicit choices
  useLayoutEffect(() => {
    // Check if the class is already correctly set (from our blocking script)
    const currentlyDark = document.documentElement.classList.contains("dark");

    if (currentlyDark !== isDark) {
      document.documentElement.classList.toggle("dark", isDark);
    }

    if (theme === "system") {
      localStorage.removeItem("app_theme");
    } else {
      localStorage.setItem("app_theme", theme);
    }
  }, [isDark, theme]);

  const value: ThemeContextType = {
    theme,
    setTheme,
    isDark,
  };

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
