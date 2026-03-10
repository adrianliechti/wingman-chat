// Empty shim for Node.js built-in modules (e.g. node:dns) that just-bash's
// browser bundle imports but cannot actually use in a browser context.
// Provides stub exports so Rollup can resolve the module without errors.

type LookupAddress = {
  address: string;
  family: 4 | 6;
};

type LookupCallback = (error: Error | null, address: string | LookupAddress[], family?: number) => void;

export function lookup(
  hostname: string,
  options?: { all?: boolean } | LookupCallback,
  callback?: LookupCallback,
) {
  const resolvedCallback = typeof options === 'function' ? options : callback;
  const all = typeof options === 'object' && options?.all;

  const error = new Error(`node:dns.lookup is not available in the browser for host \"${hostname}\"`);

  if (resolvedCallback) {
    queueMicrotask(() => {
      if (all) {
        resolvedCallback(error, []);
        return;
      }

      resolvedCallback(error, '', 4);
    });
    return;
  }

  return Promise.reject(error);
}

export default { lookup };