import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query and re-render when its match state flips.
 * The canonical React way to read viewport/media state — replaces the
 * useState + useEffect + matchMedia("change")/resize-listener boilerplate
 * with a single external-store subscription.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false, // no SSR in this client-only app; default to "not matched"
  );
}

// Tailwind's default breakpoints, so a JS layout check matches the `sm:` / `md:`
// classes used beside it instead of repeating the pixel value in every component.
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** True when the viewport is at least `breakpoint` wide (same threshold as Tailwind's `${breakpoint}:` variant). */
export function useBreakpoint(breakpoint: Breakpoint): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[breakpoint]}px)`);
}
