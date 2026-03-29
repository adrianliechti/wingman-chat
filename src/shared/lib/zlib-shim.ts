// Empty shim for Node.js built-in modules (e.g. node:zlib) that just-bash's
// browser bundle imports but cannot actually use in a browser context.
// Provides stub exports so Rollup can resolve the module without errors.

export const constants = {
  Z_BEST_COMPRESSION: 9,
  Z_BEST_SPEED: 1,
  Z_DEFAULT_COMPRESSION: -1,
};

export function gunzipSync() {
  throw new Error("node:zlib is not available in the browser");
}

export function gzipSync() {
  throw new Error("node:zlib is not available in the browser");
}

export default {};
