/** Opt in to TanStack's native diagnostic categories during local development. */
export const aiDebug = import.meta.env.DEV && import.meta.env.VITE_AI_DEBUG === "true" ? true : undefined;
