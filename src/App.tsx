import { useEffect, useState } from 'react'
import './App.css'
import { GITHUB_LOGIN_URL, fetchSession, logout } from './api'
import type { SessionUser } from '../shared/types'

type Status = 'loading' | 'anonymous' | 'authenticated'

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  github_denied: 'Bạn đã từ chối cấp quyền cho ứng dụng.',
  invalid_state:
    'Phiên đăng nhập đã hết hạn hoặc đã được dùng rồi. Vui lòng thử lại.',
  missing_code: 'GitHub không trả về mã uỷ quyền.',
  token_exchange_failed:
    'Không đổi được mã uỷ quyền với GitHub. Kiểm tra Client ID và Client Secret trong .env.',
  profile_fetch_failed: 'Không lấy được thông tin tài khoản từ GitHub.',
}

const UNKNOWN_AUTH_ERROR = 'Đăng nhập thất bại. Vui lòng thử lại.'
const API_UNREACHABLE = 'Không kết nối được tới API. Kiểm tra backend đang chạy.'

function readAuthError(): string | null {
  const code = new URLSearchParams(window.location.search).get('authError')
  if (!code) return null
  return AUTH_ERROR_MESSAGES[code] ?? UNKNOWN_AUTH_ERROR
}

function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [error, setError] = useState<string | null>(() => readAuthError())
  const [busy, setBusy] = useState(false)

  // Drop authError from the address bar so reloading does not repeat the message.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('authError')) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    fetchSession(controller.signal)
      .then((sessionUser) => {
        setUser(sessionUser)
        setStatus(sessionUser ? 'authenticated' : 'anonymous')
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        console.error(cause)
        setError(API_UNREACHABLE)
        setStatus('anonymous')
      })

    return () => controller.abort()
  }, [])

  async function handleLogout() {
    setBusy(true)
    try {
      await logout()
      setUser(null)
      setStatus('anonymous')
    } catch (cause) {
      console.error(cause)
      setError('Đăng xuất thất bại. Vui lòng thử lại.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return (
      <main className="app">
        <p className="muted">Đang kiểm tra phiên đăng nhập...</p>
      </main>
    )
  }

  return (
    <main className="app">
      <h1 className="app__title">Harness Lab</h1>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {status === 'authenticated' && user ? (
        <section className="card">
          <img
            className="card__avatar"
            src={user.avatarUrl}
            alt={`Ảnh đại diện của ${user.login}`}
            width="72"
            height="72"
          />
          <h2 className="card__name">{user.name ?? user.login}</h2>
          <a
            className="card__login"
            href={user.profileUrl}
            target="_blank"
            rel="noreferrer"
          >
            @{user.login}
          </a>
          <p className="muted">Bạn đã đăng nhập bằng GitHub.</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={handleLogout}
            disabled={busy}
          >
            Đăng xuất
          </button>
        </section>
      ) : (
        <section className="card">
          <p className="muted">
            Đăng nhập để xem thông tin tài khoản GitHub của bạn.
          </p>
          <a className="button" href={GITHUB_LOGIN_URL}>
            Đăng nhập với GitHub
          </a>
          <p className="muted muted--small">
            Ứng dụng chỉ xin quyền <code>read:user</code> và không lưu access
            token của bạn.
          </p>
        </section>
      )}
    </main>
  )
}

export default App
