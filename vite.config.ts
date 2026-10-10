import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const API_PORT_FALLBACK = '3000'
const WEB_PORT_FALLBACK = 5173

export default defineConfig(({ mode }) => {
  // Read ports from the shell first, then from .env, so the proxy target always
  // matches the port the API was started with.
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = process.env.PORT || env.PORT || API_PORT_FALLBACK
  const webPort = Number(process.env.WEB_PORT || env.WEB_PORT || WEB_PORT_FALLBACK)

  return {
    plugins: [react()],
    server: {
      port: webPort,
      // The browser only ever talks to the Vite origin, so the session cookie is
      // same-origin and no CORS handling is needed.
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    test: {
      environment: 'node',
      // Scoped to the backend so the standalone experiments keep their own runner.
      include: ['server/**/*.test.ts'],
    },
  }
})
