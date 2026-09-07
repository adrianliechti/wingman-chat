import { mergeConfig } from "vite-plus";
import appConfig from "../../vite.config";

// Browser assertions need stable pages, not development hot reloads. Isolate
// the dependency cache from concurrent gateway tests and ordinary dev servers.
export default mergeConfig(appConfig, {
  cacheDir: "node_modules/.vite-browser-tests",
  server: { hmr: false, watch: null },
});
