# Harness Engineer

A workspace for studying and building agent harnesses: the orchestration layer that
wraps an LLM with a planning loop, tool execution, memory, and safety boundaries.

## Scope

- Evaluate harness capabilities along the four dimensions: Session & Context, Control
  & Customization, Safety & Observability, Extended Capabilities.
- Prototype and test plugins, skills, hooks, MCP servers, and subagents.
- Record findings as notes under `notes/` and experiments under `experiments/`.

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
| `notes/` | Findings, harness evaluations, decisions |
| `experiments/` | Throwaway prototypes and spike code |

## Setup From Scratch

```sh
copilot plugin marketplace add obra/superpowers-marketplace
copilot plugin install superpowers@superpowers-marketplace
```
