import { describe, expect, it } from 'vitest'
import {
  SessionStore,
  StateStore,
  parseSessionCookie,
  serializeSessionCookie,
} from './sessions.ts'
import type { SessionUser } from '../shared/types.ts'

const user: SessionUser = {
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: 'https://example.test/avatar.png',
  profileUrl: 'https://github.com/octocat',
}

const SECRET = 'test-secret'

describe('SessionStore', () => {
  it('creates a session that can be read back', () => {
    const sessions = new SessionStore()
    const session = sessions.create(user)

    expect(sessions.get(session.id)?.user).toEqual(user)
    expect(session.expiresAt).toBeGreaterThan(session.createdAt)
  })

  it('treats an expired session as signed out and drops it', () => {
    let now = 1_000
    const sessions = new SessionStore({ ttlMs: 500, now: () => now })
    const session = sessions.create(user)

    now = 1_499
    expect(sessions.get(session.id)).not.toBeNull()

    now = 1_500
    expect(sessions.get(session.id)).toBeNull()
    expect(sessions.size).toBe(0)
  })

  it('forgets a destroyed session', () => {
    const sessions = new SessionStore()
    const session = sessions.create(user)

    sessions.destroy(session.id)

    expect(sessions.get(session.id)).toBeNull()
  })

  it('prunes only expired sessions', () => {
    let now = 0
    const sessions = new SessionStore({ ttlMs: 100, now: () => now })
    const first = sessions.create(user)
    now = 60
    const second = sessions.create(user)

    now = 120
    expect(sessions.prune()).toBe(1)
    expect(sessions.get(first.id)).toBeNull()
    expect(sessions.get(second.id)).not.toBeNull()
  })
})

describe('session cookie signing', () => {
  it('round-trips a signed id', () => {
    const value = serializeSessionCookie('session-id', SECRET)
    expect(parseSessionCookie(value, SECRET)).toBe('session-id')
  })

  it('rejects a tampered id', () => {
    const value = serializeSessionCookie('session-id', SECRET)
    const tampered = value.replace('session-id', 'session-XX')
    expect(parseSessionCookie(tampered, SECRET)).toBeNull()
  })

  it('rejects a value signed with another secret', () => {
    const value = serializeSessionCookie('session-id', SECRET)
    expect(parseSessionCookie(value, 'other-secret')).toBeNull()
  })

  it('rejects unsigned and malformed values', () => {
    expect(parseSessionCookie(undefined, SECRET)).toBeNull()
    expect(parseSessionCookie('', SECRET)).toBeNull()
    expect(parseSessionCookie('session-id', SECRET)).toBeNull()
    expect(parseSessionCookie('.signature', SECRET)).toBeNull()
  })
})

describe('StateStore', () => {
  it('issues unique values and accepts each one only once', () => {
    const states = new StateStore()
    const state = states.issue()

    expect(state).not.toBe(states.issue())
    expect(states.consume(state)).toBe(true)
    expect(states.consume(state)).toBe(false)
    expect(states.consume(undefined)).toBe(false)
    expect(states.consume('never-issued')).toBe(false)
  })

  it('refuses an expired value and forgets it', () => {
    let now = 0
    const states = new StateStore({ ttlMs: 100, now: () => now })
    const state = states.issue()

    now = 101
    expect(states.consume(state)).toBe(false)
    expect(states.size).toBe(0)
  })

  it('prunes expired values that were never consumed', () => {
    let now = 0
    const states = new StateStore({ ttlMs: 100, now: () => now })
    const stale = states.issue()
    now = 60
    const live = states.issue()

    now = 101
    expect(states.prune()).toBe(1)
    expect(states.size).toBe(1)
    expect(states.consume(stale)).toBe(false)
    expect(states.consume(live)).toBe(true)
  })
})
