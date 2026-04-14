import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = path.resolve(import.meta.dirname, "src");
const shim = (file: string) => path.resolve(src, "shared/lib", file);

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": src,
      // just-bash imports Node built-ins that don't exist in the browser
      "node:zlib": shim("zlib-shim.ts"),
      zlib: shim("zlib-shim.ts"),
      "node:dns": shim("dns-shim.ts"),
      dns: shim("dns-shim.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["pyodide"],
  },
  server: {
    proxy: {
      "/telemetry/v1": {
        target: "http://localhost:4318",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/telemetry\/v1/, "/v1"),
      },
      "/api/v1/realtime": {
        target: "http://localhost:8080",
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [react(), babel({ presets: [reactCompilerPreset({ target: "19" })] }), tailwindcss()],
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" ||
          warning.message?.includes("externalized for browser compatibility") ||
          warning.message?.includes("is not exported by")
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules/")) return;

          // Group vendor dependencies into logical chunks for caching.
          // Shiki is intentionally excluded — it lazy-loads grammars/themes
          // via dynamic import() and manages its own code splitting.
          const chunks: Record<string, RegExp> = {
            "vendor-react": /\/(react|react-dom)\//,
            "vendor-openai": /\/openai\//,
            "vendor-reactflow": /\/@xyflow\//,
            "vendor-bash": /\/just-bash\//,
            "vendor-docx": /\/(docx|marked|jspdf)\//,
            "vendor-markdown": /\/(unified|rehype-|remark-|emoji-regex|@fontsource\/noto-emoji|katex)\//,
            "vendor-ui": /\/(@headlessui|@floating-ui|lucide-react)\//,
          };

          for (const [chunk, re] of Object.entries(chunks)) {
            if (re.test(id)) return chunk;
          }
        },
      },
    },
  },
});
