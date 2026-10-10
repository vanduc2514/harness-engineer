# Harness Engineer

A workspace for studying and building agent harnesses: the orchestration layer that
wraps an LLM with a planning loop, tool execution, memory, and safety boundaries.

## Scope

- Evaluate harness capabilities along the four dimensions: Session & Context, Control
  & Customization, Safety & Observability, Extended Capabilities.
- Prototype and test plugins, skills, hooks, MCP servers, and subagents.
- Record findings as notes under `notes/` and experiments under `experiments/`.

## Root App: GitHub Sign-In

The repository root holds the main app: a Vite + React frontend with an Express API that
signs users in with GitHub. It exists to exercise the harness on a feature with a real
external dependency (OAuth, secrets, sessions) rather than a self-contained prototype.

How the sign-in works:

1. The browser hits `GET /api/auth/github`, which redirects to GitHub with a `state`
   value and `scope=read:user`. The same `state` is stored in a short lived httpOnly
   cookie, so the callback can tell that this browser started the flow.
2. GitHub sends the browser back to `/api/auth/github/callback` with a code.
3. The API exchanges that code for an access token, fetches the profile, then discards
   the token and sets an httpOnly session cookie.
4. The frontend renders avatar, name and username from `GET /api/auth/me`.

Sessions are stateless: the cookie is the session, signed with `SESSION_SECRET`, and
nothing is stored on the server. Any instance can answer any request, which is what lets
the same code run under `npm start` and as a Vercel function. The trade-off is that a
copied cookie stays valid until it expires, because signing out can clear it in the
browser but cannot revoke the value. The GitHub access token is never stored and never
sent to the browser.

### Setup

1. Create an OAuth App at <https://github.com/settings/applications/new> with:
   - Homepage URL `http://localhost:5173`
   - Authorization callback URL `http://localhost:5173/api/auth/github/callback`

   Add the deployed callback URL as well once you have it (see Deployment).
2. `cp .env.example .env`, then fill in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
   from that OAuth App and set `SESSION_SECRET` to `openssl rand -hex 32`.
3. `mise install && mise run install`

`mise run dev` starts the API on `:3000` and Vite on `http://localhost:5173`, which is
the address to open. If the API port is taken, set `PORT` in `.env`; Vite reads the same
value so the proxy target follows.

| Task | Purpose |
| --- | --- |
| `mise run dev` | API and Vite dev server together |
| `mise run lint` | Lint with oxlint |
| `mise run test` | Backend tests with vitest |
| `mise run e2e` | Browser test of the sign-in flow against a stub GitHub |
| `mise run build` | Type-check and build the frontend |
| `mise run verify` | lint + test + build in one pass |

### Verifying sign in

`mise run test` covers the API in isolation: the redirect it builds, the state check,
the cookie, the profile response, and every failure path. `mise run e2e` drives a real
browser through the whole flow - click the button, land back signed in, see the avatar,
reload, sign out - against a local stub that speaks GitHub's three endpoints. GitHub
will not authorise a headless browser, so the stub is what makes the browser test
possible without a human clicking "Authorize"; the stub is wired in through
`GITHUB_AUTHORIZE_URL`, `GITHUB_TOKEN_URL` and `GITHUB_USER_URL` (see `.env.example`).

Signing in against real GitHub still needs one manual click, because consent is the
whole point of the flow.

## Deployment

Two hosts, because the two parts have different needs.

| Part | Host | Why |
| --- | --- | --- |
| Todo list demo | GitHub Pages | Pure static React, nothing to run |
| Root app sign-in | Vercel | The code exchange needs a server to hold the client secret |

### Todo list demo on GitHub Pages

`.github/workflows/pages.yml` installs, tests and builds
`experiments/react-todo-list` with `VITE_BASE=/<repo>/`, then publishes it, so the demo
lands at `https://<user>.github.io/<repo>/`. Pages has to be switched to the workflow
source once:

```sh
gh api -X POST repos/<user>/<repo>/pages -f build_type=workflow
```

The `VITE_BASE` input exists because a project page is served from a subdirectory; the
build rewrites asset URLs to `/<repo>/assets/...` accordingly.

### Root app on Vercel

`api/[...route].ts` exports the same Express app that `npm start` runs, and
`vercel.json` tells Vercel to build the Vite frontend into `dist`. Configuration comes
from project environment variables, not from `.env`:

| Variable | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | from the GitHub App |
| `GITHUB_CLIENT_SECRET` | from the GitHub App |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `APP_ORIGIN` | `https://<project>.vercel.app` |
| `COOKIE_SECURE` | `true` |

`APP_ORIGIN` is what the API derives its callback URL from, so it must be the deployed
origin. That URL then has to be registered on the GitHub App as well, otherwise GitHub
refuses the exchange with `redirect_uri_mismatch`:

```text
https://<project>.vercel.app/api/auth/github/callback
```

## Tooling

GitHub Copilot CLI plugins extend the harness with skills, agents, hooks, MCP servers,
and LSP servers.

```sh
copilot plugin list
copilot plugin marketplace list
copilot plugin marketplace browse superpowers-marketplace
```

## Installed Plugins

| Plugin | Version | Marketplace | Contents |
| --- | --- | --- | --- |
| superpowers | 7.0.0 | obra/superpowers-marketplace | 15 skills (TDD, debugging, planning, code review, worktrees, subagents) |

Skills install to `~/.copilot/installed-plugins/<marketplace>/<plugin>/skills/`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/` | Root app frontend: login screen and signed-in profile |
| `server/` | Root app API: Express routes, OAuth flow, sessions, tests |
| `api/` | Vercel entry that exports the same Express app |
| `e2e/` | Browser test that drives the sign-in flow against a stub GitHub |
| `shared/` | Types shared by the API and the browser |
| `notes/` | Findings, harness evaluations, decisions |
| `experiments/` | Throwaway prototypes and spike code |

## Setup From Scratch

```sh
copilot plugin marketplace add obra/superpowers-marketplace
copilot plugin install superpowers@superpowers-marketplace
```
