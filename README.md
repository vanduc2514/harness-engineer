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

1. The browser hits `GET /api/auth/github`, which redirects to GitHub with a single-use
   `state` value and `scope=read:user`.
2. GitHub sends the browser back to `/api/auth/github/callback` with a code.
3. The API exchanges that code for an access token, fetches the profile, then discards
   the token and sets an httpOnly session cookie.
4. The frontend renders avatar, name and username from `GET /api/auth/me`.

Sessions live in memory, so restarting the API signs everyone out. The GitHub access
token is never stored on the server and never sent to the browser; a session lost to a
restart costs the user one extra click.

### Setup

1. Create an OAuth App at <https://github.com/settings/applications/new> with:
   - Homepage URL `http://localhost:5173`
   - Authorization callback URL `http://localhost:5173/api/auth/github/callback`
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
| `mise run build` | Type-check and build the frontend |
| `mise run verify` | lint + test + build in one pass |

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
| `shared/` | Types shared by the API and the browser |
| `notes/` | Findings, harness evaluations, decisions |
| `experiments/` | Throwaway prototypes and spike code |

## Setup From Scratch

```sh
copilot plugin marketplace add obra/superpowers-marketplace
copilot plugin install superpowers@superpowers-marketplace
```
