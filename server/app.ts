import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import type { Express } from 'express'
import { createAuthRouter } from './auth.ts'
import type { AppConfig } from './config.ts'
import { SessionStore, StateStore } from './sessions.ts'

export interface AppDeps {
  config: AppConfig
  sessions?: SessionStore
  states?: StateStore
  /** Swap out `fetch` in tests so no real GitHub call is made. */
  fetchImpl?: typeof fetch
  /** Built frontend directory. Served when it exists, so `npm start` can run alone. */
  distDir?: string
}

export function createApp(deps: AppDeps): Express {
  const sessions = deps.sessions ?? new SessionStore()
  const states = deps.states ?? new StateStore()

  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use(
    '/api/auth',
    createAuthRouter({
      config: deps.config,
      sessions,
      states,
      fetchImpl: deps.fetchImpl,
    }),
  )

  // Anything else under /api is a miss, never the SPA fallback.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  const distDir = deps.distDir
  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir))
    app.use((_req, res) => {
      res.sendFile(join(distDir, 'index.html'))
    })
  } else {
    app.use((_req, res) => {
      res.status(404).json({ error: 'Not found' })
    })
  }

  return app
}
