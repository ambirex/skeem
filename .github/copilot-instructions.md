# GitHub Copilot Instructions

Use `README.md` as the product specification and `AGENTS.md` as the canonical repository guidance.

## Project Intent

- This repository is implementing `skeem`, a relational-aware CLI for headless data backends.
- The repository is intentionally early-stage and may contain little or no scaffolding yet.
- Follow the package boundaries and command grammar described in `README.md`.

## Scope

- Default to Phase 1 MVP unless the user explicitly asks for later phases.
- Focus on the following work:
- Monorepo setup.
- TypeScript CLI foundation.
- Config loading.
- Directus data adapter.
- Schema caching.
- Discovery commands.
- CRUD commands.
- Relation resolution and compound execution.
- Stable JSON output envelopes.

## Guardrails

- Keep backend-agnostic logic in core packages and Directus-specific behavior in the Directus adapter.
- Do not implement later-phase system tables, extensions, extra adapters, FUSE surfaces, or Swift app work unless requested.
- Avoid adding commands, flags, or behavior that diverge from the README spec.
- When the spec is ambiguous, choose the smallest Phase 1-compatible interpretation and leave a short note if needed.

## Quality Bar

- Prefer small vertical slices that produce an end-to-end path.
- Add tests alongside new behavior, especially for parser, cache, adapter mapping, and execution flow.
- Keep agent-facing JSON output predictable and stable.
