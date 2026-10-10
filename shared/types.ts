/** The public shape of a signed-in user. Shared by the API and the browser. */
export interface SessionUser {
  login: string
  name: string | null
  avatarUrl: string
  profileUrl: string
}
