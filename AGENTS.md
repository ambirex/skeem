# AGENTS.md

This repository is an active implementation of `skeem`, a relational-aware CLI for headless data backends built for AI agents. Do not treat it like an empty scaffold or a Phase 1-only stub.

## Source Of Truth

- Start with [README.md](/Users/brent/dev/skeem/README.md) for the current repo overview.
- Use [docs/README.md](/Users/brent/dev/skeem/docs/README.md) as the documentation map.
- Use [docs/spec/full-spec.md](/Users/brent/dev/skeem/docs/spec/full-spec.md) for the original complete design document.
- Use [docs/next-slices.md](/Users/brent/dev/skeem/docs/next-slices.md) for roadmap status and the next logical implementation target.
- Prefer current code and smoke tests over stale assumptions about what is or is not implemented.

## Current State

- The repo already includes a working Directus-first CLI and adapter.
- Discovery, CRUD, relation-aware writes, schema management, system tables, aliases, provenance, versions, trash, claims, annotations, and idempotency are implemented.
- The next roadmap item is extension registry groundwork.

## Default Scope

- If the user asks to "take the next slice," use [docs/next-slices.md](/Users/brent/dev/skeem/docs/next-slices.md).
- Otherwise, prefer the smallest vertical slice that extends the current implementation cleanly.
- Keep the CLI optimized for agent usage: stable envelopes, explicit behaviors, and schema-aware workflows.

## Guardrails

- Keep backend-agnostic logic in `packages/skeem`.
- Keep Directus-specific behavior in `packages/skeem-directus`.
- Do not leak Directus response shapes into shared core interfaces unless the public contract explicitly calls for them.
- Keep docs and examples aligned with the implemented CLI, not just the aspirational spec.
- When the spec and implementation differ, document the boundary instead of silently papering over it.

## Command And Output Rules

- Preserve stable JSON envelopes.
- Keep human-readable output as a thin layer over the same result shape.
- Avoid adding surprising grammar or flags without updating docs and tests.
- For agent-facing behavior, explicitness beats convenience.

## Testing Expectations

- Add or update unit tests for new parser, runtime, schema, or system-feature logic.
- Run the Directus smoke harness for end-to-end behavior changes.
- Prefer public-behavior tests over implementation-detail tests.

## Useful Validation Commands

```bash
npm run build
npm run test
npm run smoke:directus
```

## Decision Heuristics

- Discover before mutating when backend shape is uncertain.
- Prefer idempotent, inspectable workflows for agent automation.
- When in doubt, choose the behavior that keeps the CLI predictable for another agent reading the result later.
