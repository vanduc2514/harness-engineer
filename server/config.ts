import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

export interface AppConfig {
  clientId: string
  clientSecret: string
  sessionSecret: string
  callbackUrl: string
  port: number
  cookieSecure: boolean
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/**
 * Loads `.env` if present. Node's own loader is used so no dotenv dependency is
 * needed, and a missing file is not an error: the ambient environment may
 * already hold the values.
 */
export function loadEnvFile(path: string): void {
  try {
    process.loadEnvFile(path)
  } catch {
    // No .env file: rely on the process environment.
  }
}

export function envFilePath(projectRoot: string): string {
  return join(projectRoot, '.env')
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const missing = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'].filter(
    (key) => !env[key]?.trim(),
  )
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in the values from your GitHub OAuth App.',
    )
  }

  const appOrigin = env.APP_ORIGIN?.trim() || 'http://localhost:5173'
  const sessionSecret = env.SESSION_SECRET?.trim()
  if (!sessionSecret) {
    // A random secret keeps local runs working but invalidates cookies on every
    // restart, so it is only a fallback.
    console.warn(
      'SESSION_SECRET is not set; generating a temporary one. Sessions will not survive a restart.',
    )
  }

  return {
    clientId: env.GITHUB_CLIENT_ID!.trim(),
    clientSecret: env.GITHUB_CLIENT_SECRET!.trim(),
    sessionSecret: sessionSecret || randomBytes(32).toString('hex'),
    callbackUrl:
      env.GITHUB_CALLBACK_URL?.trim() || `${appOrigin}/api/auth/github/callback`,
    port: Number(env.PORT ?? 3000),
    cookieSecure: env.COOKIE_SECURE?.trim() === 'true',
  }
}
