import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ReactCompilerConfig = {
  target: '19'
};

// Pyodide files to exclude from static copy
const PYODIDE_EXCLUDE = [
  "!**/*.{md,html}",
  "!**/*.d.ts",
  "!**/*.whl",
  "!**/node_modules",
];

// Plugin to copy Pyodide files to assets directory for local serving
function viteStaticCopyPyodide() {
  const pyodideDir = path.dirname(fileURLToPath(import.meta.resolve("pyodide")));
  return viteStaticCopy({
    targets: [
      {
        src: [path.join(pyodideDir, "*").replace(/\\/g, "/")].concat(PYODIDE_EXCLUDE),
        dest: "assets/pyodide",
      },
    ],
  });
}
// Vite plugin: override font-display for @fontsource/noto-emoji from "swap" to
// "block" so the browser never falls back to OS color emoji while the font
// file is downloading. "block" shows invisible text during the load period
// instead of the OS fallback glyph, eliminating the brief color-emoji flash.
function notoEmojiFontDisplayBlock() {
  return {
    name: 'noto-emoji-font-display-block',
    transform(code: string, id: string) {
      if (!id.includes('@fontsource/noto-emoji')) return;
      return code.replace(/font-display:\s*swap/g, 'font-display: block');
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Shim node:zlib that just-bash's browser bundle imports but can't use in the browser
      'node:zlib': path.resolve(__dirname, 'src/shared/lib/zlib-shim.ts'),
      'zlib': path.resolve(__dirname, 'src/shared/lib/zlib-shim.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['pyodide']
  },
  server: {
    proxy: {
      '/api/v1/realtime': {
        target: 'http://localhost:8081',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },

      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  plugins: [
    notoEmojiFontDisplayBlock(),
    react({
      babel: {
        plugins: [
          ["babel-plugin-react-compiler", ReactCompilerConfig],
        ],
      },
    }),
    tailwindcss(),
    viteStaticCopyPyodide()
  ],
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress Pyodide and just-bash Node.js module externalization warnings
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' || 
            warning.message?.includes('externalized for browser compatibility') ||
            warning.message?.includes('is not exported by')) {
          return;
        }
        warn(warning);
      },

      output: {
        manualChunks: {
          // Core React
          'vendor-react': [
            'react',
            'react-dom'
          ],
          // Pyodide as separate chunk for better caching
          'vendor-pyodide': [
            'pyodide'
          ],
          // Bash interpreter
          'vendor-bash': [
            'just-bash'
          ],
          // Heavy libraries split out
          'vendor-reactflow': [
            '@xyflow/react'
          ],
          'vendor-shiki': [
            'shiki'
          ],
          'vendor-mermaid': [
            'mermaid'
          ],
          // OpenAI SDK
          'vendor-openai': [
            'openai'
          ],
          // Markdown rendering
          'vendor-markdown': [
            'unified',
            'rehype-react',
            'remark-parse',
            'remark-rehype',
            'remark-breaks', 
            'remark-gfm',
            'remark-gemoji',
            'remark-math',
            'rehype-katex',
            'emoji-regex',
            '@fontsource/noto-emoji'
          ],
          // UI libraries
          'vendor-ui': [
            '@headlessui/react',
            '@floating-ui/react',
            '@floating-ui/react-dom',
            'lucide-react'
          ],
          // Utilities
          'vendor-utils': [
            'zod',
            'p-limit',
            'mime',
            'jszip'
          ]
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',
    target: 'esnext',
    cssCodeSplit: true
  },
  worker: {
    format: 'es'
  }
})
