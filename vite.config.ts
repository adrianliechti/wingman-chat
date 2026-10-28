import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { configDefaults } from "vitest/config";
import { artifactLibrarySourcesPlugin } from "./scripts/artifact-library-sources";
import { pdfjsAssetsPlugin } from "./scripts/pdfjs-assets";
import { skillsDevPlugin } from "./scripts/skills-dev";

const src = path.resolve(import.meta.dirname, "src");

const wingmanUrl = process.env.WINGMAN_URL?.replace(/\/$/, "") || "http://localhost:4242";
const wingmanToken = process.env.WINGMAN_TOKEN || "none";

// https://vite.dev/config/
export default defineConfig({
  fmt: { printWidth: 120 },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/browser/**"],
    // Run the upstream source conformance suite against Vite Plus's Vitest
    // instance instead of loading a second runner through the package's peer.
    server: { deps: { inline: ["@tanstack/ai-skills"] } },
  },
  resolve: {
    alias: {
      "@": src,
      stream: path.resolve(src, "shared/lib/saxStreamBrowser.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["pyodide"],
    // Discover the lazy Bash worker dependency before a run starts; otherwise
    // cold runs can invalidate chunks already being loaded by another page.
    include: ["just-bash/browser"],
  },
  worker: {
    // Pyodide 314 (ES-module-only) requires a module worker — classic workers
    // are unsupported. 'es' overrides Vite's default 'iife' so the interpreter
    // worker is emitted as a module (and dynamic imports keep working).
    format: "es",
    plugins: () => [artifactLibrarySourcesPlugin()],
  },
  server: {
    watch: {
      // Browser-test traces are written while the dev server is running; they
      // are outputs, not source changes, and must not reload the test page.
      ignored: ["**/test-results/**", "**/playwright-report/**"],
    },
    proxy: {
      "/telemetry/v1": {
        target: "http://localhost:4318",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/telemetry\/v1/, "/v1"),
      },
      "/api": {
        target: wingmanUrl,
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (!req.headers.authorization) {
              proxyReq.setHeader("Authorization", `Bearer ${wingmanToken}`);
            }
          });
        },
      },
    },
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset({ target: "19" })] }),
    tailwindcss(),
    skillsDevPlugin(),
    pdfjsAssetsPlugin(),
    artifactLibrarySourcesPlugin(),
  ],
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1000,
  },
});
