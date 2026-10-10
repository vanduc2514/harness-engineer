// Browser test for the GitHub sign-in flow.
//
// GitHub cannot be asked to authorise a headless browser, so this runs the app
// against a local stub that speaks the three endpoints GitHub would: authorize,
// access_token and user. That exercises the whole browser path - login button,
// redirect, callback, session cookie, profile render, logout - without needing
// anybody to click "Authorize" on github.com.
//
// Run with: mise run e2e

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const STUB_PORT = 3299
const API_PORT = 3211
const WEB_PORT = 5199
const ORIGIN = `http://localhost:${WEB_PORT}`
const STUB_ORIGIN = `http://localhost:${STUB_PORT}`

const CLIENT_ID = 'e2e-client-id'
const ACCESS_TOKEN = 'gho_e2e_token'
const AVATAR_PATH = '/avatar.svg'
const AVATAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#aa3bff"/></svg>'
const PROFILE = {
  login: 'octocat',
  name: 'The Octocat',
  avatar_url: `${STUB_ORIGIN}${AVATAR_PATH}`,
  html_url: 'https://github.com/octocat',
}

const failures = []
const notes = []

function check(label, condition, detail = '') {
  if (condition) {
    notes.push(`  ok   ${label}`)
  } else {
    failures.push(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`)
  }
}

/** Minimal stand-in for GitHub's OAuth and user endpoints. */
function startGitHubStub() {
  const seen = { authorize: null, token: null, user: null }

  const server = createServer((req, res) => {
    const url = new URL(req.url, STUB_ORIGIN)

    if (url.pathname === '/login/oauth/authorize') {
      seen.authorize = Object.fromEntries(url.searchParams)
      const redirect = new URL(url.searchParams.get('redirect_uri'))
      redirect.searchParams.set('code', 'stub-code')
      redirect.searchParams.set('state', url.searchParams.get('state'))
      res.writeHead(302, { location: redirect.toString() }).end()
      return
    }

    if (url.pathname === '/login/oauth/access_token') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        try {
          seen.token = JSON.parse(body)
        } catch {
          seen.token = { malformed: body }
        }
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ access_token: ACCESS_TOKEN, scope: 'read:user' }))
      })
      return
    }

    if (url.pathname === '/user') {
      seen.user = { authorization: req.headers.authorization ?? '' }
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(PROFILE))
      return
    }

    // Served so the avatar in the profile actually decodes in the browser.
    if (url.pathname === AVATAR_PATH) {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(AVATAR_SVG)
      return
    }

    res.writeHead(404).end()
  })

  return new Promise((resolve) => {
    server.listen(STUB_PORT, () => resolve({ server, seen }))
  })
}

function startApp() {
  const env = {
    ...process.env,
    APP_ORIGIN: ORIGIN,
    PORT: String(API_PORT),
    WEB_PORT: String(WEB_PORT),
    GITHUB_CLIENT_ID: CLIENT_ID,
    GITHUB_CLIENT_SECRET: 'e2e-client-secret',
    GITHUB_AUTHORIZE_URL: `${STUB_ORIGIN}/login/oauth/authorize`,
    GITHUB_TOKEN_URL: `${STUB_ORIGIN}/login/oauth/access_token`,
    GITHUB_USER_URL: `${STUB_ORIGIN}/user`,
    SESSION_SECRET: 'e2e-session-secret',
    COOKIE_SECURE: 'false',
  }

  const options = { env, stdio: 'pipe', detached: true }
  const api = spawn(process.execPath, [join(projectRoot, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
    ...options,
    cwd: projectRoot,
  })
  const web = spawn(process.execPath, [join(projectRoot, 'node_modules/vite/bin/vite.js')], {
    ...options,
    cwd: projectRoot,
  })

  return { api, web, logs: [api, web].map((child) => ({ child, output: '' })) }
}

async function waitForReady(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`)
      if (response.ok) return
    } catch {
      // Not up yet.
    }
    await delay(250)
  }
  throw new Error(`app did not become ready. Output:\n${child.output}`)
}

function stop(child) {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch {
    return await chromium.launch()
  }
}

async function main() {
  const { server: stub, seen } = await startGitHubStub()
  const app = startApp()
  for (const entry of app.logs) {
    entry.child.stdout?.on('data', (chunk) => {
      entry.output += chunk
    })
    entry.child.stderr?.on('data', (chunk) => {
      entry.output += chunk
    })
  }

  let browser
  try {
    await waitForReady(app.logs[0])
    browser = await launch()
    const context = await browser.newContext()
    const page = await context.newPage()
    const consoleErrors = []
    const serverErrors = []
    page.on('console', (message) => {
      // A 401 from /api/auth/me is the designed answer while signed out, so the
      // browser's "Failed to load resource" noise for it is not a defect.
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
        consoleErrors.push(message.text())
      }
    })
    page.on('response', (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`)
    })

    // Signed out: the button required by the acceptance criterion is present.
    await page.goto(ORIGIN)
    const loginButton = page.getByRole('link', { name: 'Đăng nhập với GitHub' })
    await loginButton.waitFor({ state: 'visible', timeout: 10_000 })
    check('login screen offers "Đăng nhập với GitHub"', true)

    // Sign in through the stub.
    await loginButton.click()
    const logoutButton = page.getByRole('button', { name: 'Đăng xuất' })
    await logoutButton.waitFor({ state: 'visible', timeout: 10_000 })
    check('sign in lands back on the app, signed in', true)

    check(
      'authorize request carries the client id, scope and callback',
      seen.authorize?.client_id === CLIENT_ID &&
        seen.authorize?.scope === 'read:user' &&
        seen.authorize?.redirect_uri === `${ORIGIN}/api/auth/github/callback`,
      JSON.stringify(seen.authorize),
    )
    check('authorize request carries a state', (seen.authorize?.state ?? '').length > 0)
    check(
      'code exchange is server side and authenticated',
      seen.token?.code === 'stub-code' &&
        seen.token?.client_id === CLIENT_ID &&
        seen.token?.client_secret === 'e2e-client-secret',
      JSON.stringify(seen.token),
    )
    check('profile lookup uses the access token', seen.user?.authorization === `Bearer ${ACCESS_TOKEN}`)

    // What the user sees.
    await page.getByText('The Octocat').waitFor({ state: 'visible', timeout: 10_000 })
    check('profile shows the name', true)
    await page.getByRole('link', { name: '@octocat' }).waitFor({ state: 'visible', timeout: 5_000 })
    check('profile shows the username', true)
    const avatar = page.locator('img[alt="Ảnh đại diện của octocat"]')
    check('profile shows the avatar', await avatar.isVisible())
    check('avatar points at the GitHub avatar url', (await avatar.getAttribute('src')) === PROFILE.avatar_url)
    await avatar.evaluate((image) => image.complete && image.naturalWidth > 0)
    check('avatar actually renders', await avatar.evaluate((image) => image.naturalWidth > 0))

    // The session cookie must stay out of reach of scripts.
    const cookies = await context.cookies(ORIGIN)
    const session = cookies.find((cookie) => cookie.name === 'harness_sid')
    check('session cookie is httpOnly', session?.httpOnly === true, JSON.stringify(session))
    check('session cookie is not readable from JavaScript', !(await page.evaluate(() => document.cookie)).includes('harness_sid'))

    // Session survives a reload.
    await page.reload()
    await page.getByRole('button', { name: 'Đăng xuất' }).waitFor({ state: 'visible', timeout: 10_000 })
    check('session survives a reload', true)

    // Sign out.
    await page.getByRole('button', { name: 'Đăng xuất' }).click()
    await loginButton.waitFor({ state: 'visible', timeout: 10_000 })
    check('sign out returns to the login screen', true)
    await page.reload()
    await loginButton.waitFor({ state: 'visible', timeout: 10_000 })
    check('sign out survives a reload', true)

    check('no JavaScript console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
    check('no server errors', serverErrors.length === 0, serverErrors.join(' | '))
  } finally {
    await browser?.close()
    stop(app.api)
    stop(app.web)
    stub.close()
  }

  console.log(notes.join('\n'))
  if (failures.length > 0) {
    console.error(`\n${failures.length} browser check(s) failed:\n${failures.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log(`\n${notes.length} browser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
