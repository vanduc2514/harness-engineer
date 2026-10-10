# React Todo List

Prototype todo list used to exercise the harness end to end: scaffolding, dependency
setup through `mise`, implementation, and verification by running the app rather than
reading the diff.

## What It Does

- Add, rename, delete, and check off todos.
- Inline editing by double-clicking a title, or via the Edit button.
- Filter by All / Active / Completed, plus Check all and Clear completed.
- Active and completed counts in the header.
- Todos persist to `localStorage` under `react-todo-list.todos` and are re-validated on
  load, so malformed stored payloads are discarded instead of crashing the app.

State lives in a pure reducer in [src/todos.ts](./src/todos.ts) so the logic is testable
without rendering React.

## Toolchain

Node is pinned in [mise.toml](./mise.toml). After checkout:

```sh
mise install        # install the pinned Node version
mise run install    # npm install
mise run dev        # Vite dev server on http://localhost:5173
```

## Tasks

| Task | Purpose |
| --- | --- |
| `mise run install` | Install npm dependencies |
| `mise run dev` | Start the Vite dev server |
| `mise run lint` | Lint with oxlint |
| `mise run test` | Unit test the reducer and storage helpers with vitest |
| `mise run build` | Type-check with `tsc -b` and build with Vite |
| `mise run verify` | lint + test + build in one pass |

## Layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | UI: composer, toolbar, list, footer |
| `src/todos.ts` | Pure reducer, filtering, counts, storage parsing |
| `src/types.ts` | `Todo`, `TodoAction`, `TodoFilter` types |
| `src/todos.test.ts` | Vitest coverage for reducer and storage helpers |

This is experiment code, not production code.
