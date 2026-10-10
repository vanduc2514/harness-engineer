import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SessionUser } from '../shared/types.ts'

export const SESSION_COOKIE = 'harness_sid'
export const STATE_COOKIE = 'harness_oauth_state'

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000
export const STATE_TTL_MS = 10 * 60 * 1000

export interface Session {
  user: SessionUser
  expiresAt: number
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function seal(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

function open<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const payload = token.slice(0, separator)
  const provided = Buffer.from(token.slice(separator + 1))
  const expected = Buffer.from(sign(payload, secret))
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as T
  } catch {
    return null
  }
}

/**
 * The session is the cookie. Nothing is kept on the server, so any instance can
 * answer any request, which is what serverless needs. The trade-off is that a
 * copied cookie stays valid until it expires: signing out clears it in the
 * browser but cannot revoke the value, so a shorter lifetime is the only lever.
 */
export function createSessionToken(
  user: SessionUser,
  secret: string,
  now: number = Date.now(),
): string {
  return seal({ user, expiresAt: now + SESSION_TTL_MS }, secret)
}

export function readSessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): Session | null {
  const envelope = open<{ user?: SessionUser; expiresAt?: number }>(token, secret)
  if (!envelope?.user || typeof envelope.expiresAt !== 'number') return null
  if (envelope.expiresAt <= now) return null
  return { user: envelope.user, expiresAt: envelope.expiresAt }
}

/**
 * OAuth `state` is kept in a short lived cookie alongside the copy handed to
 * GitHub, so the callback can prove it belongs to a browser that started the
 * flow without anything living in server memory.
 */
export function createState(
  secret: string,
  now: number = Date.now(),
): { state: string; token: string } {
  const state = randomBytes(24).toString('base64url')
  return { state, token: seal({ state, expiresAt: now + STATE_TTL_MS }, secret) }
}

export function readState(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): string | null {
  const envelope = open<{ state?: string; expiresAt?: number }>(token, secret)
  if (!envelope?.state || typeof envelope.expiresAt !== 'number') return null
  if (envelope.expiresAt <= now) return null
  return envelope.state
}

export function stateMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
