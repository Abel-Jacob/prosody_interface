import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getBackendTarget() {
  try {
    const apiConfigPath = path.resolve(__dirname, 'src/apiConfig.js')
    if (fs.existsSync(apiConfigPath)) {
      const content = fs.readFileSync(apiConfigPath, 'utf-8')
      const match = content.match(/export const BACKEND_DOMAIN = ["']([^"']*)["']/)
      if (match && match[1] && match[1].trim() !== '') {
        const domain = match[1].trim().replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/$/, '')
        console.log(`[Vite Proxy] Using remote BACKEND_DOMAIN from apiConfig.js: ${domain}`)
        return {
          http: `https://${domain}`,
          ws: `wss://${domain}`,
        }
      }
    }
  } catch (err) {
    console.warn('[Vite Proxy] Failed to read BACKEND_DOMAIN from apiConfig.js, defaulting to localhost:8000', err)
  }
  console.log('[Vite Proxy] Using local target: localhost:8000')
  return {
    http: 'http://localhost:8000',
    ws: 'ws://localhost:8000',
  }
}

const targets = getBackendTarget()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/ws': {
        target: targets.ws,
        ws: true,
        changeOrigin: true,
        secure: false,
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'User-Agent': 'prosody-client',
        },
      },
      '/api': {
        target: targets.http,
        changeOrigin: true,
        secure: false,
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'User-Agent': 'prosody-client',
        },
      },
    },
  },
})
