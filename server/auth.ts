import { Router } from 'express'
import type { Request, Response } from 'express'
import { parseCookie } from 'cookie'
import type { Cookies } from 'cookie'
import type { AppConfig } from './config.ts'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  STATE_COOKIE,
  STATE_TTL_MS,
  createSessionToken,
  createState,
  readSessionToken,
  readState,
  stateMatches,
} from './sessions.ts'
import type { Session } from './sessions.ts'
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
  /** Swap out `fetch` in tests so no real GitHub call is made. */
  fetchImpl?: typeof fetch
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const { config } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const router = Router()

  const baseCookie = {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  } as const

  const fail = (res: Response, code: AuthErrorCode) =>
    res.redirect(`/?authError=${code}`)

  function cookies(req: Request): Cookies {
    return parseCookie(req.headers.cookie ?? '')
  }

  function readSession(req: Request): Session | null {
    return readSessionToken(cookies(req)[SESSION_COOKIE], config.sessionSecret)
  }

  router.get('/github', (_req, res) => {
    const { state, token } = createState(config.sessionSecret)
    res.cookie(STATE_COOKIE, token, { ...baseCookie, maxAge: STATE_TTL_MS })

    const url = new URL(config.github.authorizeUrl)
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', config.callbackUrl)
    url.searchParams.set('scope', GITHUB_SCOPE)
    url.searchParams.set('state', state)
    res.redirect(url.toString())
  })

  router.get('/github/callback', async (req, res) => {
    const providedState =
      typeof req.query.state === 'string' ? req.query.state : undefined
    const code = typeof req.query.code === 'string' ? req.query.code : undefined
    const expectedState = readState(cookies(req)[STATE_COOKIE], config.sessionSecret)

    // The state cookie is single use, whatever the outcome.
    res.clearCookie(STATE_COOKIE, { path: '/' })

    if (typeof req.query.error === 'string') {
      fail(res, 'github_denied')
      return
    }
    if (!expectedState || !stateMatches(providedState, expectedState)) {
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
      res.cookie(SESSION_COOKIE, createSessionToken(user, config.sessionSecret), {
        ...baseCookie,
        maxAge: SESSION_TTL_MS,
      })
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

  router.post('/logout', (_req, res) => {
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
