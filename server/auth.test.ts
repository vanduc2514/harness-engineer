import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { GITHUB_ENDPOINTS } from './config.ts'
import type { AppConfig } from './config.ts'
import { SESSION_COOKIE, SessionStore, StateStore } from './sessions.ts'

const {
  authorizeUrl: GITHUB_AUTHORIZE_URL,
  tokenUrl: GITHUB_TOKEN_URL,
  userUrl: GITHUB_USER_URL,
} = GITHUB_ENDPOINTS

const ACCESS_TOKEN = 'gho_test_token'

const githubProfile = {
  login: 'octocat',
  name: 'The Octocat',
  avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
  html_url: 'https://github.com/octocat',
}

const config: AppConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  sessionSecret: 'test-secret',
  callbackUrl: 'http://localhost:5173/api/auth/github/callback',
  port: 0,
  cookieSecure: false,
  github: GITHUB_ENDPOINTS,
}

interface StubOptions {
  tokenStatus?: number
  tokenPayload?: unknown
  userStatus?: number
}

function createGitHubStub(options: StubOptions = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []

  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    calls.push({ url, init })

    if (url === GITHUB_TOKEN_URL) {
      return new Response(
        JSON.stringify(
          options.tokenPayload ?? { access_token: ACCESS_TOKEN, scope: 'read:user' },
        ),
        {
          status: options.tokenStatus ?? 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    if (url === GITHUB_USER_URL) {
      return new Response(JSON.stringify(githubProfile), {
        status: options.userStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected request to ${url}`)
  }) as typeof fetch

  return { fetchImpl, calls }
}

const openServers: Server[] = []

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function startServer(fetchImpl: typeof fetch) {
  const app = createApp({
    config,
    sessions: new SessionStore(),
    states: new StateStore(),
    fetchImpl,
  })
  const server = app.listen(0)
  openServers.push(server)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}` }
}

async function beginLogin(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/github`, { redirect: 'manual' })
  expect(response.status).toBe(302)
  const location = response.headers.get('location') ?? ''
  const state = new URL(location).searchParams.get('state')
  if (!state) throw new Error('authorize redirect did not carry a state')
  return state
}

function sessionCookieFrom(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
  if (!header) throw new Error('session cookie was not set')
  const [cookiePair] = header.split(';')
  return cookiePair
}

describe('GET /api/auth/github', () => {
  it('sends the browser to GitHub with the callback and scope', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await fetch(`${baseUrl}/api/auth/github`, { redirect: 'manual' })
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(302)
    expect(location.origin + location.pathname).toBe(GITHUB_AUTHORIZE_URL)
    expect(location.searchParams.get('client_id')).toBe(config.clientId)
    expect(location.searchParams.get('redirect_uri')).toBe(config.callbackUrl)
    expect(location.searchParams.get('scope')).toBe('read:user')
    expect(location.searchParams.get('state')).toBeTruthy()
  })
})

describe('GET /api/auth/github/callback', () => {
  it('exchanges the code, sets an httpOnly session cookie, and reports the profile', async () => {
    const { fetchImpl, calls } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const state = await beginLogin(baseUrl)

    const callback = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=${state}`,
      { redirect: 'manual' },
    )

    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('/')
    expect(callback.headers.getSetCookie().join(' ')).toContain('HttpOnly')
    expect(callback.headers.getSetCookie().join(' ')).toContain('SameSite=Lax')

    // The code is exchanged server side, with the secret, against GitHub.
    const tokenCall = calls.find((call) => call.url === GITHUB_TOKEN_URL)
    const tokenBody = JSON.parse(String(tokenCall?.init?.body))
    expect(tokenCall?.init?.method).toBe('POST')
    expect(tokenBody).toEqual({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: 'the-code',
      redirect_uri: config.callbackUrl,
    })

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: sessionCookieFrom(callback) },
    })
    const meBody = await me.text()

    expect(me.status).toBe(200)
    expect(JSON.parse(meBody)).toEqual({
      user: {
        login: 'octocat',
        name: 'The Octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        profileUrl: 'https://github.com/octocat',
      },
    })
    // The access token is used once and never handed to the browser.
    expect(meBody).not.toContain(ACCESS_TOKEN)
  })

  it('refuses a replayed state', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const state = await beginLogin(baseUrl)

    const first = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=${state}`,
      { redirect: 'manual' },
    )
    const second = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=${state}`,
      { redirect: 'manual' },
    )

    expect(first.headers.get('location')).toBe('/')
    expect(second.headers.get('location')).toBe('/?authError=invalid_state')
  })

  it('refuses a state it never issued', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=forged`,
      { redirect: 'manual' },
    )

    expect(response.headers.get('location')).toBe('/?authError=invalid_state')
  })

  it('reports a cancelled authorisation', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await fetch(
      `${baseUrl}/api/auth/github/callback?error=access_denied&error_description=denied`,
      { redirect: 'manual' },
    )

    expect(response.headers.get('location')).toBe('/?authError=github_denied')
  })

  it('reports a failed code exchange', async () => {
    const { fetchImpl } = createGitHubStub({ tokenStatus: 500 })
    const { baseUrl } = await startServer(fetchImpl)
    const state = await beginLogin(baseUrl)

    const response = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=${state}`,
      { redirect: 'manual' },
    )

    expect(response.headers.get('location')).toBe('/?authError=token_exchange_failed')
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('reports a token response without an access token', async () => {
    const { fetchImpl } = createGitHubStub({
      tokenPayload: { error: 'bad_verification_code' },
    })
    const { baseUrl } = await startServer(fetchImpl)
    const state = await beginLogin(baseUrl)

    const response = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=${state}`,
      { redirect: 'manual' },
    )

    expect(response.headers.get('location')).toBe('/?authError=token_exchange_failed')
  })

  it('reports a failed profile lookup', async () => {
    const { fetchImpl } = createGitHubStub({ userStatus: 403 })
    const { baseUrl } = await startServer(fetchImpl)
    const state = await beginLogin(baseUrl)

    const response = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=${state}`,
      { redirect: 'manual' },
    )

    expect(response.headers.get('location')).toBe('/?authError=profile_fetch_failed')
  })
})

describe('GET /api/auth/me', () => {
  it('reports signed out without a cookie', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await fetch(`${baseUrl}/api/auth/me`)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ user: null })
  })

  it('rejects a forged cookie', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=made-up.invalid` },
    })

    expect(response.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('drops the session and clears the cookie', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const state = await beginLogin(baseUrl)
    const callback = await fetch(
      `${baseUrl}/api/auth/github/callback?code=the-code&state=${state}`,
      { redirect: 'manual' },
    )
    const cookie = sessionCookieFrom(callback)

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    })

    expect(logout.status).toBe(204)
    expect(logout.headers.getSetCookie().join(' ')).toContain(`${SESSION_COOKIE}=;`)

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } })
    expect(me.status).toBe(401)
  })
})

describe('unknown API routes', () => {
  it('do not fall through to the SPAs index.html', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await fetch(`${baseUrl}/api/nope`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })
})
