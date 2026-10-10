import { join } from 'node:path'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'

/**
 * Vercel entry point. The catch-all filename means the function receives the
 * original URL, so the Express routes handle `/api/...` exactly as they do when
 * running under `npm start`. Configuration comes from the project environment
 * variables rather than a .env file.
 */
const app = createApp({
  config: loadConfig(),
  distDir: join(process.cwd(), 'dist'),
})

export default app
