# AGENTS.md

This repository is a greenfield implementation of `skeem`, a relational-aware CLI for headless data backends. The repository currently contains only the product specification in `README.md`.

## Source of Truth

- Treat `README.md` as the canonical product spec.
- Prefer implementing the spec over inventing behavior.
- If the spec is ambiguous, choose the smallest interpretation that preserves the Phase 1 MVP and leave a short TODO or note.
- Do not silently "improve" the product beyond the spec in ways that expand scope or change user-facing behavior.

## Default Scope

- Default to Phase 1 from the implementation priorities unless the user explicitly asks for a later phase.
- Phase 1 includes the following work:
- Monorepo scaffolding.
- TypeScript build and CLI entrypoint.
- Config loading.
- Directus data adapter.
- Schema caching.
- Relation resolution for dot notation, `@`, `?`, and `??`.
- Compound execution with best-effort rollback.
- Stable output envelopes.
- Basic discovery commands.
- `--json` support everywhere.

## Explicitly Defer Unless Asked

- Schema management beyond MVP (`define`, `diff`, full schema mutations).
- System tables and identity features (`skeem_*`, aliases, provenance, versions, trash, claims, annotations, idempotency).
- Extension loader and bundled extensions.
- Tool schema generation.
- FUSE filesystem and Swift app.
- Additional adapters beyond Directus.
- Deferred items listed in the README.

## Architecture Expectations

- Preserve the monorepo/package shape described in `README.md`.
- Keep backend-agnostic logic in `packages/skeem`.
- Keep Directus-specific behavior in `packages/skeem-directus`.
- Do not leak Directus response shapes into core interfaces.
- Shared types and errors should be defined centrally and reused consistently.

## Implementation Order

- Build vertical slices in this order:
- Workspace and CLI scaffold.
- Shared types, errors, config loading, and output formatting.
- Directus client and `introspect()`.
- Discovery commands: `ls`, `describe`, `discover`.
- Basic CRUD: `get`, `find`, `create`, `update`, `delete`.
- Cache behavior and refresh rules.
- Relation parsing and compound execution.
- Rollback and polish.

## Command and Output Rules

- Keep command names, flags, and grammar aligned with the spec.
- Prefer stable JSON envelopes for all commands.
- Human-readable output should be a thin presentation layer over the same result shape.
- Avoid adding flags or verbs that the spec does not define unless the user asks for them.

## Testing Expectations

- Add unit tests for parser, dependency resolution, cache behavior, diff/output utilities, and error handling where applicable.
- Add integration coverage against a local Directus instance for adapter behavior.
- Prefer testing the public behavior of commands and core execution paths over testing implementation details.

## Working Style

- Make small, reviewable changes that move the MVP forward.
- When introducing a new module, keep names aligned with the spec's vocabulary.
- Leave concise comments only where the logic is not obvious.
- If a spec feature depends on a later-phase system, implement the cleanest Phase 1-compatible subset and document the boundary.

## Decision Heuristics

- When in doubt, choose the version that keeps the CLI predictable for agents.
- Optimize for explicitness, stable schemas, and parseable output.
- Prefer equality-only filtering and the documented grammar unless told otherwise.
- If a requested change would pull in multiple later phases, pause and call out the scope jump before proceeding.
