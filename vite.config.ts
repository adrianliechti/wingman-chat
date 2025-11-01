import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite';

const ReactCompilerConfig = {
  target: '19'
};
// https://vite.dev/config/
export default defineConfig({
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
    tailwindcss()
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'vendor-react': [
            'react',
            'react-dom'
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
            'rehype-raw', 
            'rehype-sanitize'
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
            'jszip',
            'wavtools'
          ]
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',
    target: 'esnext'
  }
})
