/**
 * Central registry for heavy, on-demand dependencies.
 *
 * Each loader memoizes its module promise, so a library is fetched and
 * evaluated at most once per session no matter how many call sites await it.
 * This keeps these large libraries out of the initial bundle (they ship as
 * separate chunks pulled in on first use) and gives us a single inventory of
 * everything that loads lazily.
 *
 * Usage:
 *   const JSZip = await loadJSZip();
 *   const { codeToHtml } = await loadShiki();
 */

const cache = new Map<string, Promise<unknown>>();

/**
 * Wrap a dynamic `import()` in a memoized accessor. The shared primitive behind
 * every loader below; also used by feature-local loaders (e.g. the markdown
 * math plugins) so there's exactly one memoize-and-retry mechanism.
 */
export function lazy<T>(key: string, load: () => Promise<T>): () => Promise<T> {
  return () => {
    let promise = cache.get(key) as Promise<T> | undefined;
    if (!promise) {
      // Evict on failure so a transient chunk-load error can be retried.
      promise = load().catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
    }
    return promise;
  };
}

export const loadJSZip = lazy("jszip", async () => (await import("jszip")).default);
export const loadJsPDF = lazy("jspdf", async () => (await import("jspdf")).jsPDF);
export const loadHtml2Canvas = lazy("html2canvas", async () => (await import("html2canvas")).default);
export const loadShiki = lazy("shiki", () => import("shiki"));
export const loadMermaid = lazy("mermaid", async () => (await import("mermaid")).default);
export const loadMediabunny = lazy("mediabunny", () => import("mediabunny"));
