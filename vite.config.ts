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
// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
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
        // Suppress Pyodide Node.js module externalization warnings
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' || 
            warning.message?.includes('externalized for browser compatibility')) {
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
            'react-markdown', 
            'remark-breaks', 
            'remark-gfm',
            'remark-gemoji',
            'remark-math',
            'rehype-raw', 
            'rehype-sanitize',
            'rehype-katex'
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
