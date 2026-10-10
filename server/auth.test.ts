import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { GITHUB_ENDPOINTS } from './config.ts'
import type { AppConfig } from './config.ts'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  STATE_COOKIE,
  createSessionToken,
  readSessionToken,
} from './sessions.ts'
import type { SessionUser } from '../shared/types.ts'

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

const sessionUser: SessionUser = {
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  profileUrl: 'https://github.com/octocat',
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
  const app = createApp({ config, fetchImpl })
  const server = app.listen(0)
  openServers.push(server)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}` }
}

function cookieFrom(response: Response, name: string): string {
  const header = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
  if (!header) throw new Error(`${name} was not set`)
  const [pair] = header.split(';')
  return pair
}

/** Starts a sign in the way a browser would, returning the state and its cookie. */
async function beginLogin(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/auth/github`, { redirect: 'manual' })
  expect(response.status).toBe(302)

  const location = new URL(response.headers.get('location') ?? '')
  const state = location.searchParams.get('state')
  if (!state) throw new Error('authorize redirect did not carry a state')

  return { location, state, stateCookie: cookieFrom(response, STATE_COOKIE) }
}

function callback(
  baseUrl: string,
  query: string,
  cookie?: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/github/callback?${query}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
}

describe('GET /api/auth/github', () => {
  it('sends the browser to GitHub with the callback, scope and state', async () => {
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

  it('stores the state in a short lived httpOnly cookie', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await fetch(`${baseUrl}/api/auth/github`, { redirect: 'manual' })
    const setCookie = response.headers.getSetCookie().join(' ')

    expect(setCookie).toContain(`${STATE_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
  })
})

describe('GET /api/auth/github/callback', () => {
  it('exchanges the code and sets a session cookie holding the profile', async () => {
    const { fetchImpl, calls } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const { state, stateCookie } = await beginLogin(baseUrl)

    const response = await callback(
      baseUrl,
      `code=the-code&state=${state}`,
      stateCookie,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')

    const setCookie = response.headers.getSetCookie()
    expect(setCookie.some((value) => value.startsWith(`${SESSION_COOKIE}=`))).toBe(true)
    expect(setCookie.join(' ')).toContain('HttpOnly')
    expect(setCookie.join(' ')).toContain('SameSite=Lax')
    // The state cookie is spent, whatever happened.
    expect(setCookie.join(' ')).toContain(`${STATE_COOKIE}=;`)

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

    const session = cookieFrom(response, SESSION_COOKIE)
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: session } })
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

  it('refuses a state that does not match the cookie', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const { stateCookie } = await beginLogin(baseUrl)

    const response = await callback(
      baseUrl,
      'code=the-code&state=forged',
      stateCookie,
    )

    expect(response.headers.get('location')).toBe('/?authError=invalid_state')
  })

  it('refuses a state without its cookie', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const { state } = await beginLogin(baseUrl)

    const response = await callback(baseUrl, `code=the-code&state=${state}`)

    expect(response.headers.get('location')).toBe('/?authError=invalid_state')
  })

  it('refuses a callback for a state it never issued', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await callback(baseUrl, 'code=the-code&state=forged')

    expect(response.headers.get('location')).toBe('/?authError=invalid_state')
  })

  it('refuses a callback with no state at all', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)

    const response = await callback(baseUrl, 'code=the-code')

    expect(response.headers.get('location')).toBe('/?authError=invalid_state')
  })

  it('reports a cancelled authorisation', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const { stateCookie } = await beginLogin(baseUrl)

    const response = await callback(
      baseUrl,
      'error=access_denied&error_description=denied',
      stateCookie,
    )

    expect(response.headers.get('location')).toBe('/?authError=github_denied')
  })

  it('reports a callback with no code', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const { state, stateCookie } = await beginLogin(baseUrl)

    const response = await callback(baseUrl, `state=${state}`, stateCookie)

    expect(response.headers.get('location')).toBe('/?authError=missing_code')
  })

  it('reports a failed code exchange', async () => {
    const { fetchImpl } = createGitHubStub({ tokenStatus: 500 })
    const { baseUrl } = await startServer(fetchImpl)
    const { state, stateCookie } = await beginLogin(baseUrl)

    const response = await callback(
      baseUrl,
      `code=the-code&state=${state}`,
      stateCookie,
    )

    expect(response.headers.get('location')).toBe('/?authError=token_exchange_failed')
    expect(
      response.headers.getSetCookie().some((value) => value.startsWith(SESSION_COOKIE)),
    ).toBe(false)
  })

  it('reports a token response without an access token', async () => {
    const { fetchImpl } = createGitHubStub({
      tokenPayload: { error: 'bad_verification_code' },
    })
    const { baseUrl } = await startServer(fetchImpl)
    const { state, stateCookie } = await beginLogin(baseUrl)

    const response = await callback(
      baseUrl,
      `code=the-code&state=${state}`,
      stateCookie,
    )

    expect(response.headers.get('location')).toBe('/?authError=token_exchange_failed')
  })

  it('reports a failed profile lookup', async () => {
    const { fetchImpl } = createGitHubStub({ userStatus: 403 })
    const { baseUrl } = await startServer(fetchImpl)
    const { state, stateCookie } = await beginLogin(baseUrl)

    const response = await callback(
      baseUrl,
      `code=the-code&state=${state}`,
      stateCookie,
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

  it('rejects a session signed with another secret', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const foreign = createSessionToken(sessionUser, 'another-secret')

    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${foreign}` },
    })

    expect(response.status).toBe(401)
  })

  it('rejects an expired session', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const stale = createSessionToken(
      sessionUser,
      config.sessionSecret,
      Date.now() - SESSION_TTL_MS - 1,
    )

    expect(readSessionToken(stale, config.sessionSecret)).toBeNull()
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${stale}` },
    })

    expect(response.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const { fetchImpl } = createGitHubStub()
    const { baseUrl } = await startServer(fetchImpl)
    const { state, stateCookie } = await beginLogin(baseUrl)
    const signedIn = await callback(
      baseUrl,
      `code=the-code&state=${state}`,
      stateCookie,
    )
    const session = cookieFrom(signedIn, SESSION_COOKIE)

    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: session },
    })

    expect(response.status).toBe(204)
    expect(response.headers.getSetCookie().join(' ')).toContain(`${SESSION_COOKIE}=;`)

    // A browser that honours the clear cookie is signed out. The token itself
    // stays valid until it expires, which is the price of a stateless session.
    const me = await fetch(`${baseUrl}/api/auth/me`)
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
