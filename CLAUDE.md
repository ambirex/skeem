# CLAUDE.md

Use `AGENTS.md` as the canonical repo guidance and keep this file aligned with it.

## Project Context

- This repo is implementing `skeem` from the specification in `README.md`.
- The repo is intentionally early-stage; do not assume missing structure is accidental.
- Read the relevant README sections before making architectural decisions.

## Default Mission

- Stay focused on Phase 1 MVP unless the user explicitly asks for later phases.
- Prioritize the following work:
- Monorepo scaffold.
- TypeScript CLI foundation.
- Config loading.
- Directus data adapter.
- Schema cache.
- Discovery commands.
- CRUD commands.
- Relation resolution and compound execution.
- Stable `--json` output.

## Guardrails

- `README.md` is the source of truth for commands, flags, package layout, and feature boundaries.
- Keep core logic backend-agnostic and Directus logic adapter-specific.
- Do not implement system tables, extensions, extra adapters, FUSE, or Swift surfaces unless asked.
- Avoid spec drift: if behavior is unclear, choose the narrowest Phase 1-compatible interpretation.

## Implementation Notes

- Favor small vertical slices over broad scaffolding with no end-to-end path.
- Keep JSON output contracts stable and easy for agents to parse.
- Add tests as features land, especially around parser, cache, adapter mapping, and execution flow.
- Prefer explicit TODOs over speculative architecture for later phases.
