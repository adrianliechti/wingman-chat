import { QueryClient } from "@tanstack/react-query";

/**
 * The one query cache for remote inventories (models, MCP availability, skill
 * templates). Hooks pass it explicitly and helper code calls `fetchQuery` on
 * it, so React and non-React callers share the same entries and nothing needs
 * a provider to work. `App` still mounts it in a `QueryClientProvider` so
 * devtools and future hooks find it.
 *
 * Retries are off: inventories refetch on focus, reconnect and their own
 * schedule, which matches the previous hand-written caches and keeps failures
 * immediate for callers that fall back to a backend default.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 60_000,
    },
  },
});
