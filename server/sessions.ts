import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SessionUser } from '../shared/types.ts'

export const SESSION_COOKIE = 'harness_sid'

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000

export interface Session {
  id: string
  user: SessionUser
  createdAt: number
  expiresAt: number
}

export interface SessionStoreOptions {
  ttlMs?: number
  now?: () => number
}

/**
 * Sessions live in memory, so restarting the API signs everyone out. That is an
 * acceptable trade here because the GitHub access token is used once and then
 * discarded, so a lost session costs the user one extra click.
 */
export class SessionStore {
  readonly #sessions = new Map<string, Session>()
  readonly #ttlMs: number
  readonly #now: () => number

  constructor(options: SessionStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? SESSION_TTL_MS
    this.#now = options.now ?? Date.now
  }

  get size(): number {
    return this.#sessions.size
  }

  create(user: SessionUser): Session {
    const createdAt = this.#now()
    const session: Session = {
      id: randomBytes(24).toString('base64url'),
      user,
      createdAt,
      expiresAt: createdAt + this.#ttlMs,
    }
    this.#sessions.set(session.id, session)
    return session
  }

  get(id: string): Session | null {
    const session = this.#sessions.get(id)
    if (!session) return null
    if (session.expiresAt <= this.#now()) {
      this.#sessions.delete(id)
      return null
    }
    return session
  }

  destroy(id: string): void {
    this.#sessions.delete(id)
  }

  /** Drops expired entries and returns how many were removed. */
  prune(): number {
    const now = this.#now()
    let removed = 0
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(id)
        removed += 1
      }
    }
    return removed
  }
}

/**
 * Single-use `state` values that tie an OAuth callback back to the browser
 * request that started it, which is what stops login CSRF.
 */
export class StateStore {
  readonly #states = new Map<string, number>()
  readonly #ttlMs: number
  readonly #now: () => number

  constructor(options: SessionStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_STATE_TTL_MS
    this.#now = options.now ?? Date.now
  }

  get size(): number {
    return this.#states.size
  }

  issue(): string {
    const state = randomBytes(24).toString('base64url')
    this.#states.set(state, this.#now() + this.#ttlMs)
    return state
  }

  /** Returns true only the first time a live state value is seen. */
  consume(state: string | undefined): boolean {
    if (!state) return false
    const expiresAt = this.#states.get(state)
    if (expiresAt === undefined) return false
    this.#states.delete(state)
    return expiresAt > this.#now()
  }

  prune(): number {
    const now = this.#now()
    let removed = 0
    for (const [state, expiresAt] of this.#states) {
      if (expiresAt <= now) {
        this.#states.delete(state)
        removed += 1
      }
    }
    return removed
  }
}

export function signSessionId(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id).digest('base64url')
}

/** The cookie carries `<id>.<hmac>` so a forged id cannot be guessed. */
export function serializeSessionCookie(id: string, secret: string): string {
  return `${id}.${signSessionId(id, secret)}`
}

export function parseSessionCookie(
  value: string | undefined,
  secret: string,
): string | null {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null

  const id = value.slice(0, separator)
  const provided = Buffer.from(value.slice(separator + 1))
  const expected = Buffer.from(signSessionId(id, secret))
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null
  return id
}
