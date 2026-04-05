# GitHub Copilot Instructions

Use `AGENTS.md` as the canonical repository guidance.

## Project Intent

- This repository is an active implementation of `skeem`, a relational-aware CLI for headless data backends.
- Do not assume the repo is empty or that only early scaffolding exists.
- Start with `README.md` and `docs/README.md` for current behavior; use `docs/spec/full-spec.md` for the original full design.

## Scope

- Default to the next logical roadmap slice in `docs/next-slices.md` unless the user asks for something else.
- Focus on small, end-to-end improvements that fit the current Directus-first implementation.
- Keep JSON output envelopes stable and agent-friendly.

## Guardrails

- Keep backend-agnostic logic in core packages and Directus-specific behavior in the Directus adapter.
- Keep docs and examples aligned with the implemented command surface.
- Avoid adding commands, flags, or behavior that diverge from the documented CLI without updating tests and docs.
- When the spec is ambiguous, choose the smallest interpretation consistent with current code and roadmap direction.

## Quality Bar

- Prefer small vertical slices that produce an end-to-end path.
- Add tests alongside new behavior, especially for parser, cache, adapter mapping, runtime orchestration, and execution flow.
- Run the Directus smoke harness for significant behavior changes.
- Keep agent-facing JSON output predictable and stable.
