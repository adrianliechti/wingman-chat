import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite';

const ReactCompilerConfig = {
  target: '19'
};
// https://vite.dev/config/
export default defineConfig({
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
          // Vendor chunks
          'vendor-react': [
            'react',
            'react-dom'
          ],
          'vendor-openai': [
            'openai'
          ],
          'vendor-markdown': [
            'react-markdown', 
            'remark-breaks', 
            'remark-gfm', 
            'rehype-raw', 
            'rehype-sanitize',
            'remark',
            'remark-html'
          ],
          'vendor-ui': [
            '@headlessui/react',
            '@floating-ui/react',
            '@floating-ui/react-dom'
          ],
          'vendor-utils': [
            'zod',
            'p-limit',
            'mime'
          ],
          'vendor-icons': ['lucide-react'],
        },
        chunkFileNames: (chunkInfo) => {
          // Move shiki language bundles to shiki subfolder
          if (chunkInfo.name?.includes('shiki') || 
              chunkInfo.facadeModuleId?.includes('shiki') ||
              (chunkInfo.moduleIds && chunkInfo.moduleIds.some(id => id.includes('shiki')))) {
            return 'assets/shiki/[name]-[hash].js';
          }
          // Move mermaid bundles to mermaid subfolder
          if (chunkInfo.name?.includes('mermaid') || 
              chunkInfo.facadeModuleId?.includes('mermaid') ||
              (chunkInfo.moduleIds && chunkInfo.moduleIds.some(id => id.includes('mermaid')))) {
            return 'assets/mermaid/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',
    target: 'esnext'
  }
})
