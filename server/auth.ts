import { Router } from 'express'
import type { Request, Response } from 'express'
import { parseCookie } from 'cookie'
import type { AppConfig } from './config.ts'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  parseSessionCookie,
  serializeSessionCookie,
} from './sessions.ts'
import type { Session, SessionStore, StateStore } from './sessions.ts'
import type { SessionUser } from '../shared/types.ts'

export const GITHUB_SCOPE = 'read:user'

export type AuthErrorCode =
  | 'github_denied'
  | 'invalid_state'
  | 'missing_code'
  | 'token_exchange_failed'
  | 'profile_fetch_failed'

/** Raised when GitHub refuses the code exchange, as opposed to a network fault. */
export class TokenExchangeError extends Error {
  override name = 'TokenExchangeError'
}

export interface AuthRouterOptions {
  config: AppConfig
  sessions: SessionStore
  states: StateStore
  fetchImpl?: typeof fetch
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const { config, sessions, states } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const router = Router()

  const fail = (res: Response, code: AuthErrorCode) =>
    res.redirect(`/?authError=${code}`)

  function readSession(req: Request): Session | null {
    const cookies = parseCookie(req.headers.cookie ?? '')
    const id = parseSessionCookie(cookies[SESSION_COOKIE], config.sessionSecret)
    return id ? sessions.get(id) : null
  }

  router.get('/github', (_req, res) => {
    const url = new URL(config.github.authorizeUrl)
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', config.callbackUrl)
    url.searchParams.set('scope', GITHUB_SCOPE)
    // Single-use and verified on the way back, which is what blocks login CSRF.
    url.searchParams.set('state', states.issue())
    res.redirect(url.toString())
  })

  router.get('/github/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : undefined
    const code = typeof req.query.code === 'string' ? req.query.code : undefined

    if (typeof req.query.error === 'string') {
      fail(res, 'github_denied')
      return
    }
    if (!states.consume(state)) {
      fail(res, 'invalid_state')
      return
    }
    if (!code) {
      fail(res, 'missing_code')
      return
    }

    try {
      const accessToken = await exchangeCodeForToken(config, code, fetchImpl)
      const user = await fetchGitHubUser(config, accessToken, fetchImpl)
      const session = sessions.create(user)
      res.cookie(
        SESSION_COOKIE,
        serializeSessionCookie(session.id, config.sessionSecret),
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.cookieSecure,
          path: '/',
          maxAge: SESSION_TTL_MS,
        },
      )
      res.redirect('/')
    } catch (error) {
      console.error('GitHub sign in failed:', error)
      fail(
        res,
        error instanceof TokenExchangeError
          ? 'token_exchange_failed'
          : 'profile_fetch_failed',
      )
    }
  })

  router.get('/me', (req, res) => {
    const session = readSession(req)
    if (!session) {
      res.status(401).json({ user: null })
      return
    }
    res.json({ user: session.user })
  })

  router.post('/logout', (req, res) => {
    const cookies = parseCookie(req.headers.cookie ?? '')
    const id = parseSessionCookie(cookies[SESSION_COOKIE], config.sessionSecret)
    if (id) sessions.destroy(id)
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.status(204).end()
  })

  return router
}

async function exchangeCodeForToken(
  config: AppConfig,
  code: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(config.github.tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  })

  if (!response.ok) {
    throw new TokenExchangeError(
      `GitHub token endpoint responded with ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!payload.access_token) {
    throw new TokenExchangeError(
      payload.error_description ?? payload.error ?? 'no access token returned',
    )
  }
  return payload.access_token
}

async function fetchGitHubUser(
  config: AppConfig,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<SessionUser> {
  const response = await fetchImpl(config.github.userUrl, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'x-github-api-version': '2022-11-28',
      // GitHub rejects API requests without a user agent.
      'user-agent': 'harness-lab',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub user endpoint responded with ${response.status}`)
  }

  const profile = (await response.json()) as {
    login?: string
    name?: string | null
    avatar_url?: string
    html_url?: string
  }
  if (!profile.login) {
    throw new Error('GitHub profile response did not include a login')
  }

  return {
    login: profile.login,
    name: profile.name ?? null,
    avatarUrl: profile.avatar_url ?? '',
    profileUrl: profile.html_url ?? `https://github.com/${profile.login}`,
  }
}
