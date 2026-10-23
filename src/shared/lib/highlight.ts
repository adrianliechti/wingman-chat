/** Highlights code with shiki (loaded on demand) on a transparent background. */
export async function highlightCode(code: string, lang: string, isDark: boolean): Promise<string> {
  const { codeToHtml } = await import("shiki");
  return codeToHtml(code, {
    lang,
    theme: isDark ? "one-dark-pro" : "one-light",
    colorReplacements: {
      "#fafafa": "transparent", // one-light background
      "#282c34": "transparent", // one-dark-pro background
    },
  });
}
