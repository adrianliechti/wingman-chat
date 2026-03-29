import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite plugin: override font-display for @fontsource/noto-emoji from "swap" to
// "block" so the browser never falls back to OS color emoji while the font
// file is downloading. "block" shows invisible text during the load period
// instead of the OS fallback glyph, eliminating the brief color-emoji flash.
function notoEmojiFontDisplayBlock() {
  return {
    name: "noto-emoji-font-display-block",
    transform(code: string, id: string) {
      if (!id.includes("@fontsource/noto-emoji")) return;
      return code.replace(/font-display:\s*swap/g, "font-display: block");
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Shim node:zlib that just-bash's browser bundle imports but can't use in the browser
      "node:zlib": path.resolve(import.meta.dirname, "src/shared/lib/zlib-shim.ts"),
      zlib: path.resolve(import.meta.dirname, "src/shared/lib/zlib-shim.ts"),
      // Shim node:dns that just-bash's browser bundle imports for network resolution
      "node:dns": path.resolve(import.meta.dirname, "src/shared/lib/dns-shim.ts"),
      dns: path.resolve(import.meta.dirname, "src/shared/lib/dns-shim.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["pyodide"],
  },
  server: {
    proxy: {
      "/api/v1/realtime": {
        target: "http://localhost:8081",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },

      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [
    notoEmojiFontDisplayBlock(),
    react(),
    babel({
      presets: [reactCompilerPreset({ target: "19" })],
    }),
    tailwindcss(),
  ],
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        // Suppress Pyodide and just-bash Node.js module externalization warnings
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
          const chunks: Record<string, RegExp> = {
            "vendor-react": /node_modules\/(react|react-dom)\//,
            "vendor-bash": /node_modules\/just-bash\//,
            "vendor-reactflow": /node_modules\/@xyflow\/react\//,
            "vendor-shiki": /node_modules\/shiki\//,
            "vendor-mermaid": /node_modules\/mermaid\//,
            "vendor-openai": /node_modules\/openai\//,
            "vendor-markdown":
              /node_modules\/(unified|rehype-react|remark-parse|remark-rehype|remark-breaks|remark-gfm|remark-gemoji|remark-math|rehype-katex|emoji-regex|@fontsource\/noto-emoji)\//,
            "vendor-ui":
              /node_modules\/(@headlessui\/react|@floating-ui\/react|@floating-ui\/react-dom|lucide-react)\//,
            "vendor-utils": /node_modules\/(zod|p-limit|mime|jszip|marked)\//,
            "vendor-docx": /node_modules\/docx\//,
          };
          for (const [chunk, re] of Object.entries(chunks)) {
            if (re.test(id)) return chunk;
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    target: "esnext",
  },
});
