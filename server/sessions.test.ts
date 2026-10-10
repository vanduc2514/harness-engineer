import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  SESSION_TTL_MS,
  STATE_TTL_MS,
  createSessionToken,
  createState,
  readSessionToken,
  readState,
  stateMatches,
} from './sessions.ts'
import type { SessionUser } from '../shared/types.ts'

const user: SessionUser = {
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: 'https://example.test/avatar.png',
  profileUrl: 'https://github.com/octocat',
}

const SECRET = 'test-secret'

describe('session token', () => {
  it('round-trips the user and the expiry', () => {
    const token = createSessionToken(user, SECRET, 1_000)

    expect(readSessionToken(token, SECRET, 1_500)).toEqual({
      user,
      expiresAt: 1_000 + SESSION_TTL_MS,
    })
  })

  it('expires exactly at its expiry time', () => {
    const token = createSessionToken(user, SECRET, 1_000)

    expect(readSessionToken(token, SECRET, 1_000 + SESSION_TTL_MS - 1)).not.toBeNull()
    expect(readSessionToken(token, SECRET, 1_000 + SESSION_TTL_MS)).toBeNull()
  })

  it('rejects a token signed with another secret', () => {
    const token = createSessionToken(user, SECRET, 1_000)

    expect(readSessionToken(token, 'other-secret', 1_500)).toBeNull()
  })

  it('rejects a swapped payload', () => {
    const token = createSessionToken(user, SECRET, 1_000)
    const signature = token.slice(token.lastIndexOf('.') + 1)
    const forged = Buffer.from(
      JSON.stringify({ user: { ...user, login: 'attacker' }, expiresAt: 9e15 }),
    ).toString('base64url')

    expect(readSessionToken(`${forged}.${signature}`, SECRET, 1_500)).toBeNull()
  })

  it('rejects a correctly signed payload that is not JSON', () => {
    const payload = Buffer.from('not-json').toString('base64url')
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url')

    expect(readSessionToken(`${payload}.${signature}`, SECRET, 0)).toBeNull()
  })

  it('rejects missing and malformed values', () => {
    expect(readSessionToken(undefined, SECRET)).toBeNull()
    expect(readSessionToken('', SECRET)).toBeNull()
    expect(readSessionToken('no-separator', SECRET)).toBeNull()
    expect(readSessionToken('.signature-only', SECRET)).toBeNull()
  })
})

describe('oauth state', () => {
  it('round-trips the state through its cookie token', () => {
    const { state, token } = createState(SECRET, 1_000)

    expect(state).toHaveLength(32)
    expect(readState(token, SECRET, 1_500)).toBe(state)
  })

  it('expires exactly at its expiry time', () => {
    const { token } = createState(SECRET, 1_000)

    expect(readState(token, SECRET, 1_000 + STATE_TTL_MS - 1)).not.toBeNull()
    expect(readState(token, SECRET, 1_000 + STATE_TTL_MS)).toBeNull()
  })

  it('issues a fresh state every time', () => {
    expect(createState(SECRET).state).not.toBe(createState(SECRET).state)
  })

  it('rejects a token signed with another secret', () => {
    const { token } = createState(SECRET, 1_000)

    expect(readState(token, 'other-secret', 1_500)).toBeNull()
    expect(readState(undefined, SECRET, 1_500)).toBeNull()
  })

  it('matches only an identical state', () => {
    expect(stateMatches('abc', 'abc')).toBe(true)
    expect(stateMatches('abc', 'abd')).toBe(false)
    expect(stateMatches('abc', 'abcd')).toBe(false)
    expect(stateMatches(undefined, 'abc')).toBe(false)
  })
})
