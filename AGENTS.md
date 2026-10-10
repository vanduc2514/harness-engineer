# AGENTS.md

Instructions for AI agents working in this repository.

## Purpose

This repo is a lab for harness engineering: evaluating, extending, and prototyping the
orchestration layer around coding agents (skills, hooks, MCP servers, subagents, context
management, and safety boundaries).

## Conventions

### Branches

- `experiment/` for spikes and prototypes
- `notes/` for documentation and findings
- `plugin/` for plugin or skill authoring

### Commits

Short, meaningful messages under 100 words. No bullet points. Include context and
purpose, not just the mechanical change.

Prefixes:

- `notes:` documentation and findings
- `experiment:` prototype code
- `plugin:` plugin, skill, hook, or MCP server changes
- `chore:` cleanup and non-behavioral changes

## Workflow

1. Plan the change before writing code.
2. Make the smallest change that tests the hypothesis.
3. Verify by running the harness, not by reading the diff.
4. Record the outcome in `notes/` when it changes how we work.

## Guardrails

- Keep experiments isolated under `experiments/`; they are not production code.
- Never commit credentials, tokens, or machine-specific paths.
- Prefer extending existing plugin mechanisms over ad-hoc scripts.
