# skeem

Relational-aware CLI for headless backends, built for AI agents.

`skeem` gives agents and developers a compact, schema-aware way to inspect data, perform relational writes, manage schema drift, and coordinate multi-step work against a headless backend. The core is backend-agnostic; backends are pluggable adapters.

**Agents:** start with [SKILL.md](SKILL.md) (the playbook) and [llms.txt](llms.txt) (the map). Or run `skeem tools --format anthropic|openai` to generate tool definitions from your live schema.

## Status

`skeem` 0.5.x is published to npm: run it with `npx skeem` or install it globally. Node 20+ is required.

- Adapters: **Directus**, **PocketBase**, **NocoDB** (full-tier), **Strapi** (data-tier), and **WikiData** (read-tier)
- Discovery, CRUD, upsert, link, unlink, and compound `exec`
- Relation-aware writes with dot notation plus `@`, `?`, and `??`
- Schema `discover`, `diff`, and `define`, including m2o/m2m relations and enum fields
- `skeem tools` generates OpenAI/Anthropic tool definitions from the live schema
- System features for aliases, provenance, versions, trash, claims, annotations, and idempotency
- Stable JSON envelopes designed for agent callers

See [docs/adapter-roadmap.md](docs/adapter-roadmap.md) for shipped and candidate adapters, and [docs/next-slices.md](docs/next-slices.md) for upcoming work.

## Why Agents Use It

- Coordination primitives: claims, provenance, versions, trash, annotations, and idempotency keep multi-agent writes safe and auditable — the layer raw backend APIs don't provide.
- Compact relational grammar: agents can create or resolve related records without hand-building multiple API calls.
- Schema-aware discovery: `ls`, `describe`, and `discover` let an agent inspect the backend before acting.
- Predictable output: every command can return a stable JSON envelope with `--json`.
- Backend abstraction: core behavior lives in `packages/skeem`; adapters (Directus, PocketBase, NocoDB, Strapi, WikiData) are swapped via the `adapter` config field.
- Self-describing: `skeem tools` emits LLM tool definitions from the live schema, and [SKILL.md](SKILL.md) teaches the envelope + relation grammar.

## Where It Fits

- Versus hand-rolled REST/SDK calls: one schema-aware command replaces several API requests, with idempotency, provenance, and stable JSON built in.
- Versus an MCP server: `skeem` is a plain CLI, so any agent with shell access can drive it — no server process, low token overhead, and it composes with pipes and scripts.
- `skeem` is not an ORM, a migration framework, or a database client: it works at the API level of the backend and delegates storage concerns to it.

## Install

```bash
npx skeem ls --url http://127.0.0.1:8055 --token "$DIRECTUS_TOKEN"
```

Or install globally:

```bash
npm install -g skeem
skeem ls --url http://127.0.0.1:8055 --token "$DIRECTUS_TOKEN"
```

`skeem` pulls in `@skeems/directus` automatically. Node 20+ is required.

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

- [SKILL.md](SKILL.md) — agent playbook (envelope contract, relation grammar, workflow)
- [llms.txt](llms.txt) — curated map of the repo for LLMs
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
│   ├── skeem-types/      # shared types + adapter contract
│   ├── skeem-directus/   # Directus adapter (full)
│   ├── skeem-pocketbase/ # PocketBase adapter (full)
│   ├── skeem-nocodb/     # NocoDB adapter (full)
│   ├── skeem-strapi/     # Strapi adapter (data tier)
│   └── skeem-wikidata/   # WikiData adapter (read-only)
├── docs/                 # Guides, references, architecture notes, full spec
├── test/                 # Smoke + conformance harness and fixtures
├── SKILL.md              # Agent playbook
├── llms.txt              # LLM-oriented repo map
├── AGENTS.md             # Codex / agent guidance
└── CLAUDE.md             # Claude-specific wrapper guidance
```

## Development

```bash
npm run build
npm run test
npm run smoke:directus          # deep Directus end-to-end suite
npm run conformance:directus    # cross-adapter contract suite (also :pocketbase, :nocodb)
```

CI runs build, typecheck, unit tests, and a package-content guard on every push
([ci.yml](.github/workflows/ci.yml)); the end-to-end smoke and conformance suites
run on pushes to `main` and on demand ([smoke.yml](.github/workflows/smoke.yml)).

Helpful entry points:

- [packages/skeem/src/cli/index.ts](packages/skeem/src/cli/index.ts)
- [packages/skeem/src/core/runtime.ts](packages/skeem/src/core/runtime.ts)
- [packages/skeem-directus/src/adapter.ts](packages/skeem-directus/src/adapter.ts)
- [test/smoke/directus-ls.mjs](test/smoke/directus-ls.mjs)

## Notes

- The repo started from a single large spec. That original document is preserved at [docs/spec/full-spec.md](docs/spec/full-spec.md).
- The current codebase has moved well beyond the original Phase 1 scaffold, so prefer the current docs and tests when understanding what is implemented today.
