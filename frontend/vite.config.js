import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Local dev proxy: forwards /api requests to the local backend.
      // Only used when BACKEND_DOMAIN is empty (no tunnel URL set).
      // When a tunnel URL is set, the frontend connects directly to it.
      '/api/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/lexirep': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
