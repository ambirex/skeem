# Documentation

This repo started life as one large specification. The docs are now split so agents and humans can get to the right level of detail faster.

## Start Here

- [Getting Started](guides/getting-started.md) for first-run setup and a working Directus flow
- [Agent Workflows](guides/agent-workflows.md) for JSON-first usage, claims, provenance, and compound plans
- [LLM Eval Plan](guides/llm-evals.md) for use cases, assumptions, and a minimal real-model test rig
- [CLI Reference](reference/cli.md) for verb-by-verb behavior
- [Configuration Reference](reference/configuration.md) for `.skeemrc.yaml`, profiles, env vars, and cache behavior

## Product Areas

- [Schema Management](reference/schema-management.md) for `describe`, `discover`, `diff`, and `define`
- [System Features](reference/system-features.md) for `init`, aliases, versions, trash, claims, annotations, and idempotency
- [Architecture Overview](architecture/overview.md) for package boundaries, runtime responsibilities, and test strategy

## Roadmap And Spec

- [Next Slices](next-slices.md) tracks what is completed and what should land next
- [Adapter Roadmap](adapter-roadmap.md) ranks candidate backend integrations and the prerequisites for adapter #2
- [Full Product Spec](spec/full-spec.md) preserves the original complete design document

## How To Read The Docs

- Use the guides when you want working workflows.
- Use the reference pages when you need exact command shapes or config fields.
- Use the architecture notes when you are changing code.
- Use the full spec when a feature edge case or future-facing design question is not covered elsewhere.
