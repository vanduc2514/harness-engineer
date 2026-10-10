import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { ConfigError, envFilePath, loadConfig, loadEnvFile } from './config.ts'
import type { AppConfig } from './config.ts'
import { SessionStore, StateStore } from './sessions.ts'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(envFilePath(projectRoot))

function resolveConfig(): AppConfig | null {
  try {
    return loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      return null
    }
    throw error
  }
}

function main() {
  const config = resolveConfig()
  if (!config) {
    process.exitCode = 1
    return
  }

  const sessions = new SessionStore()
  const states = new StateStore()
  const app = createApp({
    config,
    sessions,
    states,
    distDir: join(projectRoot, 'dist'),
  })

  const pruneTimer = setInterval(
    () => {
      sessions.prune()
      states.prune()
    },
    15 * 60 * 1000,
  )
  pruneTimer.unref()

  const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`)
    console.log(`GitHub callback URL: ${config.callbackUrl}`)
  })

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${config.port} is already in use. Set PORT in .env to a free port.`,
      )
      process.exitCode = 1
      return
    }
    throw error
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        process.exit(0)
      })
    })
  }
}

main()
