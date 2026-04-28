export interface LaunchParams {
  q?: string;
  send: boolean;
  importCompressed?: string;
  importJson?: string;
}

/** Parse deep-link launch params from the URL search string and hash. Hash takes precedence over search. */
export function parseLaunchParams(search: string, hash: string): LaunchParams {
  const merged: Record<string, string> = {};

  const searchParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [k, v] of searchParams) merged[k] = v;

  // Hash overrides search when it looks like a query string
  if (hash.startsWith("#") && hash.includes("=")) {
    const hashParams = new URLSearchParams(hash.slice(1));
    for (const [k, v] of hashParams) merged[k] = v;
  }

  const q = merged.q ?? merged.prompt ?? merged.text;
  const send = merged.send === "1" || merged.send === "true";

  return {
    q: q || undefined,
    send,
    importCompressed: merged.import || undefined,
    importJson: merged.import_json || undefined,
  };
}
