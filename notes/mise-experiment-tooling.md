# Experiment Tooling With Mise

## Observation

Scaffolding a frontend experiment with the ambient Node install worked, but nothing in
the repo recorded which Node version the experiment needed. Reproducing it on another
machine depended on whatever `node` happened to be on `PATH`, and the commands to set
the project up lived only in chat history.

## Change

Experiments now pin their toolchain with a `mise.toml` next to the code, and expose the
setup and verification steps as mise tasks.

`experiments/react-todo-list/mise.toml`:

```toml
[tools]
node = "22"

[tasks.verify]
description = "Run lint, tests, and build in sequence"
depends = ["lint", "test", "build"]
```

`mise run verify` is the single command that answers "is this experiment still good?".
Because `verify` declares dependencies, lint, tests, and build run from one task instead
of three ad-hoc shell invocations.

## Notes

- `mise install` reads the pinned `node` and is a no-op once satisfied, so it is safe to
  run on every fresh checkout.
- Tasks are per-experiment, so an experiment can add `test:watch` or a preview task
  without touching the repo root.
- Verification has to run the harness, not the diff: `mise run verify` covers lint,
  tests, and the production build, and the dev server was additionally started and
  fetched to confirm the app actually renders.
- `mise trust` is required the first time a new `mise.toml` is seen; the global config
  here already trusts repo paths.

## Follow-Up

If more experiments land, consider a shared `mise.toml` at the repo root holding only
tool versions, and keep task definitions per experiment.
