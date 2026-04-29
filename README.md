# skeem

Relational-aware CLI for headless backends, built for AI agents.

`skeem` gives agents and developers a compact, schema-aware way to inspect data, perform relational writes, manage schema drift, and coordinate multi-step work against a headless backend. The current implementation is Directus-first and smoke-tested end to end against a local Directus fixture.

## Status

`skeem` is usable from source today.

- Directus adapter with schema introspection
- Discovery, CRUD, upsert, link, unlink, and compound `exec`
- Relation-aware writes with dot notation plus `@`, `?`, and `??`
- Schema `discover`, `diff`, and `define`
- System features for aliases, provenance, versions, trash, claims, annotations, and idempotency
- Stable JSON envelopes designed for agent callers

The next roadmap item is extension registry groundwork. See [docs/next-slices.md](docs/next-slices.md).

## Why Agents Use It

- Schema-aware discovery: `ls`, `describe`, and `discover` let an agent inspect the backend before acting.
- Predictable output: every command can return a stable JSON envelope with `--json`.
- Compact relational grammar: agents can create or resolve related records without hand-building multiple API calls.
- Coordination primitives: provenance, claims, annotations, versions, trash, and idempotency help keep multi-agent workflows sane.
- Backend abstraction: core behavior lives in `packages/skeem`; the current adapter targets Directus.

## Install

```bash
npm install -g @skeem/cli
skeem ls --url http://127.0.0.1:8055 --token "$DIRECTUS_TOKEN"
```

`@skeem/cli` pulls in `@skeem/directus` automatically. Node 20+ is required.

### From source

```bash
npm install
npm run build
node packages/skeem/dist/bin/skeem.js ls --url http://127.0.0.1:8055 --token "$DIRECTUS_TOKEN"
```

For local end-to-end validation:

```bash
npm run smoke:directus
```

## Quickstart

Create a `.skeemrc.yaml` in your project root:

```yaml
default: local
actor: docs-agent

profiles:
  local:
    adapter: directus
    connection:
      url: http://127.0.0.1:8055
      token: ${DIRECTUS_TOKEN}

schema:
  exclude:
    - directus_*

cache:
  ttl_seconds: 3600
```

Then start with discovery:

```bash
skeem ls --counts
skeem describe companies
skeem discover -o schema.skeem.yaml
```

Do a first write:

```bash
skeem create companies --name "Acme" --industry Manufacturing --json
skeem find companies --where name=Acme --json
skeem update companies 1 --industry Robotics --json
```

Initialize agent-oriented system tables when you want provenance, soft delete, claims, versions, annotations, and aliases:

```bash
skeem init --json
```

## Docs

- [Docs Index](docs/README.md)
- [Getting Started](docs/guides/getting-started.md)
- [Agent Workflows](docs/guides/agent-workflows.md)
- [LLM Eval Plan](docs/guides/llm-evals.md)
- [CLI Reference](docs/reference/cli.md)
- [Configuration Reference](docs/reference/configuration.md)
- [Schema Management](docs/reference/schema-management.md)
- [System Features](docs/reference/system-features.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Full Product Spec](docs/spec/full-spec.md)

## Repo Layout

```text
skeem/
├── packages/
│   ├── skeem/            # CLI + core runtime
│   └── skeem-directus/   # Directus adapter
├── docs/                 # Guides, references, architecture notes, full spec
├── test/                 # Smoke harness and fixtures
├── AGENTS.md             # Codex / agent guidance
└── CLAUDE.md             # Claude-specific wrapper guidance
```

## Development

```bash
npm run build
npm run test
npm run smoke:directus
```

Helpful entry points:

- [packages/skeem/src/cli/index.ts](packages/skeem/src/cli/index.ts)
- [packages/skeem/src/core/runtime.ts](packages/skeem/src/core/runtime.ts)
- [packages/skeem-directus/src/adapter.ts](packages/skeem-directus/src/adapter.ts)
- [test/smoke/directus-ls.mjs](test/smoke/directus-ls.mjs)

## Notes

- The repo started from a single large spec. That original document is preserved at [docs/spec/full-spec.md](docs/spec/full-spec.md).
- The current codebase has moved well beyond the original Phase 1 scaffold, so prefer the current docs and tests when understanding what is implemented today.
