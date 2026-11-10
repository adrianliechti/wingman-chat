import { createThemeCss, themeTokenClasses } from "@tanstack/highlight/theme";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import { oneDarkProTheme } from "@tanstack/highlight/themes/one-dark-pro";

// Keep layout and backgrounds with the renderer/editor. Only token colors change with the theme.
const css = `${createThemeCss({
  light: githubLightTheme,
  dark: oneDarkProTheme,
  includeBaseStyles: false,
})}
.syntax-highlight { color: var(--th-token); }
${themeTokenClasses.map((token) => `.syntax-highlight .th-${token} { color: var(--th-${token}); }`).join("\n")}`;

export function HighlightStyles() {
  // React hoists and deduplicates this stylesheet across all code blocks and editor mirrors.
  return (
    <style href="wingman-syntax-highlight" precedence="default">
      {css}
    </style>
  );
}
