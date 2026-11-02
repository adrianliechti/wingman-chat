import { createContext } from "react";

/** Let a host (chat) keep its own scroll anchoring and top-bar clearance. */
export const MarkdownNavigationContext = createContext<((resolve: () => HTMLElement | null) => void) | null>(null);

/** Fragment links belong to their message or preview, including nested previews. */
export function markdownFragmentTarget(link: HTMLAnchorElement, hash: string): HTMLElement | null {
  const scope = link.closest("[data-markdown-document]");
  const targets = (scope ?? link.ownerDocument).querySelectorAll<HTMLElement>(`#${CSS.escape(hash)}`);
  return Array.from(targets).find((target) => target.closest("[data-markdown-document]") === scope) ?? null;
}
