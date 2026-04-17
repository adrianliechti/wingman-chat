import { useEffect, useState } from "react";

const WELL_KNOWN_PATH = "/.well-known/wingman-configuration";
export const COMPANION_ID = "companion";
const POLL_INTERVAL_MS = 20_000;

export function companionMcpUrl(url: string): string {
  return `${url}/mcp`;
}

async function checkAvailability(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}${WELL_KNOWN_PATH}`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useCompanion(url: string | undefined): { available: boolean } {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!url) {
      setAvailable(false);
      return;
    }

    const resolvedUrl = url;
    let cancelled = false;

    async function poll() {
      const result = await checkAvailability(resolvedUrl);
      if (!cancelled) setAvailable(result);
    }

    poll();
    const id = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [url]);

  return { available };
}
