# CLAUDE.md

Use `AGENTS.md` as the canonical repo guidance and keep this file aligned with it.

## Project Context

- This repo is a working implementation of `skeem`, not an empty scaffold.
- Start with `README.md` and `docs/README.md` for current behavior, then use `docs/spec/full-spec.md` for deeper design context.
- Use `docs/next-slices.md` when the user asks for the next logical slice.

## Default Mission

- Extend the existing Directus-first CLI cleanly and incrementally.
- Prefer the next documented roadmap slice unless the user redirects.
- Keep the tool reliable for agents: stable JSON, good docs, and end-to-end smoke coverage.

## Guardrails

- `AGENTS.md` is the canonical repo guidance.
- `README.md` and `docs/README.md` describe the current repo surface.
- `docs/spec/full-spec.md` preserves the original full design.
- Keep core logic backend-agnostic and Directus logic adapter-specific.
- Keep docs, smoke coverage, and behavior aligned.
- Avoid spec drift: if behavior is unclear, choose the smallest consistent interpretation and document the edge.

## Implementation Notes

- Favor small vertical slices over broad speculative framework work.
- Keep JSON output contracts stable and easy for agents to parse.
- Add or update smoke coverage when behavior changes materially.
- Prefer explicit roadmap notes over hand-wavy future architecture.
