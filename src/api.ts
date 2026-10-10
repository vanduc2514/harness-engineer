import type { SessionUser } from '../shared/types'

export const GITHUB_LOGIN_URL = '/api/auth/github'

export async function fetchSession(signal?: AbortSignal): Promise<SessionUser | null> {
  const response = await fetch('/api/auth/me', { signal })
  if (response.status === 401) return null
  if (!response.ok) {
    throw new Error(`Session request failed with status ${response.status}`)
  }
  const payload = (await response.json()) as { user: SessionUser | null }
  return payload.user
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Logout request failed with status ${response.status}`)
  }
}
