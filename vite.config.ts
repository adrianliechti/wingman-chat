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
          'vendor-markdown': [
            'react-markdown', 
            'remark-breaks', 
            'remark-gfm', 
            'rehype-raw', 
            'rehype-sanitize',
            'remark',
            'remark-html'
          ],
          'vendor-icons': ['lucide-react'],
          'vendor-monaco': [
            '@monaco-editor/react',
            '@monaco-editor/loader'
          ],
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',
    target: 'esnext'
  }
})
