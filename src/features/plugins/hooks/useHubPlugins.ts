import { useCallback, useEffect, useState } from "react";
import { loadHubPlugins } from "@/features/plugins/lib/hub";
import type { HubPlugin } from "@/features/plugins/lib/types";

/** Loads the plugin hub catalog on mount; `reload` retries after a failure. */
export function useHubPlugins(hubUrl: string | undefined) {
  const [plugins, setPlugins] = useState<HubPlugin[]>([]);
  const [loading, setLoading] = useState(Boolean(hubUrl));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!hubUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadHubPlugins(hubUrl)
      .then((loaded) => {
        if (cancelled) return;
        setPlugins(loaded);
        if (loaded.length === 0) setError("Hub returned no plugins");
      })
      .catch(() => {
        if (!cancelled) setError("Failed to reach hub");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hubUrl, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { plugins, loading, error, reload };
}
