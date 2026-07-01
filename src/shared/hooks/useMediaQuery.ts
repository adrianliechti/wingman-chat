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
