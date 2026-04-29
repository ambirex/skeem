# skeem — Complete Specification

> A relational-aware CLI for headless data backends, designed for AI agents.
> Directus adapter first. Open source. Monorepo.

---

## Table of Contents

**Part I — Overview and Architecture**
1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Project Structure and Tooling](#3-project-structure-and-tooling)
4. [Configuration](#4-configuration)
5. [Schema Caching](#5-schema-caching)

**Part II — Data Operations**
6. [Data Operation Grammar](#6-data-operation-grammar)
7. [Compound Operations and Relation Resolution](#7-compound-operations-and-relation-resolution)
8. [Batch / Pipe Operations](#8-batch--pipe-operations)
9. [Nested Reads](#9-nested-reads)
10. [Upsert](#10-upsert)
11. [M2M Link / Unlink](#11-m2m-link--unlink)

**Part III — Schema Management**
12. [Schema Definition](#12-schema-definition)
13. [Schema Discovery](#13-schema-discovery)
14. [Schema Diffing](#14-schema-diffing)

**Part IV — System Tables and Identity**
15. [System Initialization](#15-system-initialization)
16. [System Tables](#16-system-tables)
17. [Identity Resolution and Aliases](#17-identity-resolution-and-aliases)
18. [Provenance Tracking](#18-provenance-tracking)
19. [Versioning and Soft Delete](#19-versioning-and-soft-delete)
20. [Agent Coordination (Claims)](#20-agent-coordination-claims)
21. [Annotations](#21-annotations)
22. [Idempotency](#22-idempotency)

**Part V — Extension System**
23. [Extension Architecture](#23-extension-architecture)
24. [Memory Extension](#24-memory-extension)
25. [Knowledge Graph Extension](#25-knowledge-graph-extension)
26. [Extension Registry and Third-Party Extensions](#26-extension-registry-and-third-party-extensions)

**Part VI — Agent Integration**
27. [Agent Tool Schema Generation](#27-agent-tool-schema-generation)
28. [Output Contract](#28-output-contract)

**Part VII — Platform Surfaces**
29. [skeem-fs: FUSE Filesystem](#29-skeem-fs-fuse-filesystem)
30. [skeem-swift-app: Apple Ecosystem Client](#30-skeem-swift-app-apple-ecosystem-client)

**Part VIII — Adapter Interfaces and Types**
31. [Adapter Interface — Data](#31-adapter-interface--data)
32. [Adapter Interface — Schema](#32-adapter-interface--schema)
33. [Adapter Interface — Discovery](#33-adapter-interface--discovery)
34. [Shared Types](#34-shared-types)
35. [Error Types](#35-error-types)

**Part IX — Operations and Deployment**
36. [Rollback Strategy](#36-rollback-strategy)
37. [Directus Adapter Reference](#37-directus-adapter-reference)
38. [Permissions and Partial Visibility](#38-permissions-and-partial-visibility)
39. [Testing Strategy](#39-testing-strategy)

**Part X — Reference**
40. [Full CLI Verb Summary](#40-full-cli-verb-summary)
41. [Implementation Priorities](#41-implementation-priorities)
42. [Appendix: Example — Agent Memory Bootstrap](#42-appendix-example--agent-memory-bootstrap)

---

# Part I — Overview and Architecture

## 1. Overview

### What skeem is

skeem is an open-source CLI tool that understands relational schemas and lets you express
multi-entity operations concisely. It is built for two audiences:

1. **AI agents** that need to interact with structured data backends via tool calls. The
   CLI's command grammar maps directly to tool schemas. `--json` output is predictable
   and parseable. Schema introspection means tool definitions can be auto-generated.

2. **Developers** scripting data operations, bootstrapping schemas, seeding environments,
   and managing schema-as-code for headless backends.

### What skeem is not

skeem is not an ORM, a migration framework, a query language, or a database client. It
operates at the API level of headless data platforms (Directus, Supabase, Strapi, etc.)
and delegates all storage concerns to the backend.

### Core insight

The pattern is the same across every headless data backend: you have a schema with
relationships, a CRUD API, and the need to express multi-entity operations concisely.
The specific API calls differ, but the grammar of what you're trying to say is universal.

skeem provides that grammar as a core library, with backend-specific adapters that
handle API translation. The first adapter targets Directus.

### Three layers

skeem provisions three layers of schema on a backend:

1. **User schema** — Your application's collections and relations. Managed via
   `skeem define` and `skeem discover`.

2. **System tables** (`skeem_*`) — Infrastructure that every multi-agent setup needs:
   identity resolution, provenance, versioning, coordination, idempotency. Provisioned
   by `skeem init`.

3. **Extensions** (`skeem_{ext}_*`) — Opt-in domain schemas: memory systems, knowledge
   graphs, task queues. Installed via `skeem extend <name>`.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        CLI Layer                         │
│  Parses args, routes to commands, formats output         │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                     skeem core                           │
│  Operation grammar parser                                │
│  Dependency graph resolver                               │
│  Compound operation executor                             │
│  Schema cache manager                                    │
│  Rollback coordinator                                    │
│  Output envelope formatter                               │
│  Schema diffing engine                                   │
│  Tool schema generator                                   │
│  System table behaviors (provenance, versioning, etc.)   │
│  Extension loader                                        │
└────────────────────────┬────────────────────────────────┘
                         │  Adapter Interface
┌────────────────────────▼────────────────────────────────┐
│               skeem-directus (adapter)                   │
│  Directus REST API client                                │
│  Schema introspection mapper                             │
│  Directus-specific type mapping                          │
│  Auth / token handling                                   │
│  System collection filtering                             │
│  WebSocket client (for live events)                      │
└─────────────────────────────────────────────────────────┘
```

All compound logic (dependency resolution, rollback, notation parsing, output formatting,
caching, diffing, system table behaviors) lives in skeem core. Adapters implement a small,
well-defined interface of primitive operations. Writing a new adapter (e.g., skeem-supabase)
requires implementing ~10 methods, not understanding the full operation grammar.

---

## 3. Project Structure and Tooling

### Language

TypeScript / Node.js. Rationale:

- Directus's API is REST/JSON; the ecosystem is natural.
- `npm install -g skeem` is the expected distribution path for the target audience.
- Contributor pool is maximized.
- If CLI cold-start latency becomes a bottleneck in agent loops, the adapter interface
  is clean enough that a Rust/Go rewrite of the CLI wrapper is bounded work — the core
  logic and adapter can remain TypeScript.

### Monorepo layout

```
skeem/
├── packages/
│   ├── skeem/                    # Core library + CLI
│   │   ├── src/
│   │   │   ├── cli/              # Command definitions (create, get, find, etc.)
│   │   │   ├── core/             # Operation parser, dependency resolver, executor
│   │   │   ├── cache/            # Schema cache manager
│   │   │   ├── diff/             # Schema diffing engine
│   │   │   ├── system/           # System table behaviors (provenance, versioning, etc.)
│   │   │   ├── extensions/       # Extension loader and registry
│   │   │   ├── tools/            # Agent tool schema generator
│   │   │   ├── output/           # Envelope formatter (JSON, human-readable)
│   │   │   └── types/            # Shared TypeScript interfaces
│   │   ├── bin/
│   │   │   └── skeem.ts          # CLI entrypoint
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── skeem-directus/           # Directus adapter
│   │   ├── src/
│   │   │   ├── adapter.ts        # SkemAdapter implementation
│   │   │   ├── schema-adapter.ts # SkemSchemaAdapter implementation
│   │   │   ├── discovery.ts      # SkemDiscoveryAdapter implementation
│   │   │   ├── client.ts         # Directus REST client wrapper
│   │   │   ├── websocket.ts      # Directus WebSocket client (live events)
│   │   │   ├── introspect.ts     # Schema introspection mapper
│   │   │   └── types.ts          # Directus-specific type mappings
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── extend-memory/            # Memory extension
│   │   ├── skeem-extension.yaml
│   │   ├── schema.skeem.yaml
│   │   ├── src/
│   │   │   ├── index.ts          # CLI commands: remember, recall, forget, reinforce
│   │   │   ├── scoping.ts        # Access-scoped query middleware
│   │   │   └── maintenance.ts    # Decay, expiry, dedup
│   │   └── package.json
│   │
│   └── extend-kg/                # Knowledge graph extension
│       ├── skeem-extension.yaml
│       ├── schema.skeem.yaml
│       ├── src/
│       │   ├── index.ts          # CLI commands: kg add, kg traverse, kg path
│       │   ├── traversal.ts      # BFS/DFS graph traversal
│       │   └── extraction.ts     # Optional LLM entity extraction
│       └── package.json
│
├── schemas/                      # Example .skeem.yaml schema files
│   └── agent-memory.skeem.yaml
│
├── test/
│   ├── conformance/              # Adapter conformance test suite
│   └── docker-compose.yaml       # Directus test instance
│
├── package.json                  # Workspace root
├── tsconfig.base.json
└── README.md
```

### Package manager

pnpm workspaces (or npm workspaces). Turborepo optional for build orchestration.

### Build

TypeScript compiled to ESM with CJS fallback. CLI entrypoint uses a shebang
(`#!/usr/bin/env node`) for global install.

---

## 4. Configuration

### Config file

skeem looks for configuration in this order:

1. CLI flags (`--adapter`, `--url`, `--token`, `--profile`)
2. Environment variables (`SKEEM_ADAPTER`, `SKEEM_URL`, `SKEEM_TOKEN`)
3. `.skeemrc.yaml` in current directory, walking up to filesystem root
4. `~/.config/skeem/config.yaml` (global default)

### Config shape

```yaml
# .skeemrc.yaml

# Simple (single environment)
adapter: directus
connection:
  url: "https://my-instance.directus.cloud"
  token: "${SKEEM_TOKEN}"             # env var interpolation

# Optional schema overrides (normally auto-discovered)
schema:
  aliases:                            # short names for long collection names
    person: human_resources_personnel
    company: corporate_entities
  exclude:                            # hide collections from discovery
    - directus_*                      # default: exclude system collections
    - _temp_*

# Extension config
extensions:
  memory:
    default_space_type: private
    decay_rate: 0.01                  # per day
    working_memory_ttl: 86400         # 24 hours
  kg:
    entity_extraction:
      enabled: false
      model: claude-sonnet-4-20250514
      provider: anthropic
      api_key: "${ANTHROPIC_API_KEY}"

# Multi-environment
profiles:
  dev:
    adapter: directus
    connection:
      url: "http://localhost:8055"
      token: "${SKEEM_DEV_TOKEN}"
  staging:
    adapter: directus
    connection:
      url: "https://staging.example.com"
      token: "${SKEEM_STAGING_TOKEN}"
  prod:
    adapter: directus
    connection:
      url: "https://prod.example.com"
      token: "${SKEEM_PROD_TOKEN}"

default: dev
```

### Profile selection

```bash
skeem --profile prod ls --counts
SKEEM_PROFILE=staging skeem discover
```

---

## 5. Schema Caching

Calling `introspect()` on every CLI invocation adds a round-trip that compounds in
agent loops running dozens of commands. skeem maintains a local schema cache.

### Cache location

```
.skeem/
  cache/
    schema.json                   # Cached introspection result
    meta.json                     # Cache metadata (timestamp, source URL, adapter)
```

### Cache behavior

- `skeem discover`, `skeem ls`, `skeem describe`, and `skeem define` always hit the
  live backend and update the cache as a side effect.
- `skeem create`, `skeem get`, `skeem find`, `skeem update`, `skeem delete`,
  `skeem link`, `skeem unlink`, and `skeem upsert` use the cache for schema
  resolution (dot notation, `?` notation, relation lookups).
- If no cache exists, these commands call `introspect()` once, cache the result,
  then proceed.
- Cache TTL is configurable (default: 1 hour). After TTL expiry, next data command
  refreshes the cache before executing.

### Cache flags

```bash
skeem create person --name "Jane" --no-cache     # Force live introspection
skeem create person --name "Jane" --refresh       # Refresh cache, then execute
skeem cache clear                                 # Delete local cache
skeem cache show                                  # Show cache age and stats
```

### Agent optimization

For agent loops that will execute many commands:

```bash
# Pre-warm the cache once, then run many commands against it
skeem discover --json > /dev/null   # Side effect: cache is now fresh
for row in ...; do
  skeem create person --name "$row" --company ?name="Acme"
done
```

---

# Part II — Data Operations

## 6. Data Operation Grammar

### Primitives

```
skeem create <collection> [--field value ...]
skeem get <collection> <id> [--expand relation ...]
skeem find <collection> [--where field=value ...] [--limit N] [--offset N] [--sort field] [--expand relation ...]
skeem update <collection> <id> [--field value ...]
skeem delete <collection> <id>
skeem upsert <collection> --match field=value [--field value ...]
skeem link <collection>:<id> <related_collection> <target>
skeem unlink <collection>:<id> <related_collection> <target>
skeem exec                            # Read JSON operation plan from stdin
```

All commands accept:

- `--json` — structured JSON output (default for piped stdout; auto-detected via `isatty`)
- `--profile <name>` — select config profile
- `--no-cache` — bypass schema cache
- `--dry-run` — show execution plan without executing
- `--yes` — skip confirmation prompts
- `--verbose` / `-v` — show execution details (API calls, timing)
- `--actor <id>` — identify the caller (for provenance, claims, memory scoping)
- `--context <json>` — attach context to provenance records
- `--idempotency-key <key>` — dedup key for retryable operations

### Global flags

```
--adapter <name>     Override adapter from config
--url <url>          Override connection URL
--token <token>      Override auth token
--profile <name>     Select config profile
--json               Force JSON output
--no-cache           Bypass schema cache
--refresh            Refresh schema cache before executing
--dry-run            Show plan without executing
--yes / -y           Skip confirmation prompts
--verbose / -v       Show execution details
--no-rollback        On compound failure, preserve partial state
--actor <id>         Caller identity for provenance
--context <json>     Context metadata for provenance
--idempotency-key    Dedup key for retryable operations
```

---

## 7. Compound Operations and Relation Resolution

The power of skeem is expressing multi-entity operations in a single command.
skeem reads the schema to understand relationships and resolves dependencies automatically.

### Notation

There are four ways to reference a related entity:

#### 1. Nested Creation — dot notation

Create a related entity inline. skeem sees that `company_id` is an M2O relation
on `person` pointing to `companies`, creates the company first, captures the ID,
and wires it in.

```bash
skeem create person \
  --name "Jane Doe" \
  --email "jane@acme.com" \
  --company.name "Acme Corp" \
  --company.industry "Technology"
```

Execution plan:
1. Create `companies` with `{ name: "Acme Corp", industry: "Technology" }` → id 42
2. Create `person` with `{ name: "Jane Doe", email: "jane@acme.com", company_id: 42 }`

#### 2. Reference by ID — @ notation

Link to an existing entity by ID. No lookup, no creation.

```bash
skeem create person \
  --name "Jane Doe" \
  --company @42
```

Sets `company_id: 42` directly.

#### 3. Resolve — ? notation

Find an existing entity by a field value and use its ID.
Fails if not found (0 results) or ambiguous (>1 results).

Resolution checks the target collection's own fields first, then checks
`skeem_aliases` for matching aliases. See [Identity Resolution](#17-identity-resolution-and-aliases).

```bash
skeem create person \
  --name "Jane Doe" \
  --company ?name="Acme Corp"
```

Execution plan:
1. Find `companies` where `name = "Acme Corp"` (or alias match) → id 42 (or error)
2. Create `person` with `{ name: "Jane Doe", company_id: 42 }`

#### 4. Resolve-or-Create — ?? notation

Find by field, create if not found. The idempotent relation pattern.

```bash
skeem create person \
  --name "Jane Doe" \
  --company ??name="Acme Corp"
```

If a company named "Acme Corp" exists (or has a matching alias), use its ID.
If not, create a minimal one with `{ name: "Acme Corp" }`. Additional fields
for fallback creation are supplied with dot notation:

```bash
skeem create person \
  --name "Jane Doe" \
  --company ??name="Acme Corp" \
  --company.industry "Technology"
```

Here, `industry` is only set if the company is *created* (not if resolved).

### Notation Summary

| Syntax | Meaning | Adapter calls |
|---|---|---|
| `--company.name "X"` | Create related entity | `create` |
| `--company @42` | Use existing by ID | (none — inline) |
| `--company ?name="X"` | Resolve existing by field (+ aliases) | `findOne` + alias lookup |
| `--company ??name="X"` | Resolve or create (+ aliases) | `findOne` + alias lookup, then maybe `create` |

### Deep nesting

Dot notation supports depth > 1 when the schema has chained relations:

```bash
skeem create person \
  --name "Jane Doe" \
  --company.name "Acme Corp" \
  --company.address.city "Minneapolis" \
  --company.address.state "MN"
```

skeem resolves this as a three-level dependency chain:
1. Create `addresses` → id 7
2. Create `companies` with `address_id: 7` → id 42
3. Create `person` with `company_id: 42`

If the intermediate relation doesn't exist, skeem reports a clear error:
`"No relation found from 'companies' to resolve path 'address'"`.

---

## 8. Batch / Pipe Operations

For complex multi-step workflows that exceed what CLI args can express, skeem accepts
a JSON operation plan on stdin via `skeem exec`:

```bash
cat <<'EOF' | skeem exec
{
  "operations": [
    { "ref": "acme", "op": "create", "collection": "companies", "data": { "name": "Acme Corp" } },
    { "ref": "jane", "op": "create", "collection": "person", "data": { "name": "Jane", "company_id": "$acme.id" } },
    { "ref": "bob",  "op": "create", "collection": "person", "data": { "name": "Bob",  "company_id": "$acme.id" } }
  ]
}
EOF
```

### Variable references

The `$ref.field` syntax lets operations reference outputs of earlier operations.
skeem resolves the DAG and executes in dependency order.

### Operation types in exec

```typescript
interface ExecOperation {
  ref: string;                         // Handle for referencing this operation's output
  op: 'create' | 'get' | 'find' | 'findOne' | 'update' | 'delete' | 'upsert' | 'link' | 'unlink';
  collection: string;
  id?: string;                         // For get/update/delete (may contain $ref)
  data?: Record<string, unknown>;      // For create/update (values may contain $ref)
  filter?: Record<string, unknown>;    // For find/findOne
  match?: Record<string, unknown>;     // For upsert
  target?: string;                     // For link/unlink
}
```

### Bulk create optimization

When an adapter implements `createMany`, skeem detects independent `create` operations
on the same collection within an exec plan and batches them into a single API call.

---

## 9. Nested Reads

By default, `skeem get` and `skeem find` return flat records with raw FK values.
The `--expand` flag resolves relations inline.

```bash
# Flat (default)
skeem get people 17 --json
# { "id": 17, "name": "Jane", "company_id": 42 }

# Expanded
skeem get people 17 --expand company --json
# { "id": 17, "name": "Jane", "company_id": 42, "company": { "id": 42, "name": "Acme" } }

# Multiple expansions
skeem get people 17 --expand company --expand tags --json

# Deep expansion (dot path)
skeem get people 17 --expand company.address --json

# Expand all direct relations
skeem get people 17 --expand-all --json
```

For Directus, `--expand company` maps to `GET /items/people/17?fields=*,company_id.*`.

---

## 10. Upsert

For agent workflows that might retry on failure, `skeem upsert` provides idempotent
top-level operations.

```bash
skeem upsert company --match name="Acme Corp" --industry "Technology" --website "https://acme.com"
```

Behavior:
1. Find `companies` where `name = "Acme Corp"` (including alias resolution).
2. If found: update with `{ industry: "Technology", website: "https://acme.com" }`.
3. If not found: create with all fields.
4. If >1 found: error (AmbiguousError).

### Composite match

```bash
skeem upsert person --match name="Jane" --match company_id=42 --role "CTO"
```

### Output

```json
{
  "ok": true,
  "operation": "upsert",
  "action": "updated",
  "collection": "companies",
  "data": { "id": 42, "name": "Acme Corp", "industry": "Technology", "website": "https://acme.com" }
}
```

---

## 11. M2M Link / Unlink

Sugar over junction table record operations.

```bash
# Link by ID
skeem link memories:17 tags:3

# Link with resolve (includes alias lookup)
skeem link memories:17 tags ?name="user-preference"

# Unlink
skeem unlink memories:17 tags:3
```

skeem infers the junction table and FK field names from the schema.

---

# Part III — Schema Management

## 12. Schema Definition

### Inline CLI

```bash
# Create a collection with fields
skeem define collection memories \
  --field content:text:required \
  --field embedding:json \
  --field relevance:float \
  --field created_at:datetime:default=now

# Add a field to an existing collection
skeem define field memories.tags:json

# Create a M2O relation
skeem define relation memories.conversation_id -> conversations

# Create a M2M relation (junction table auto-generated)
skeem define relation memories <-> tags
```

### Declarative YAML

For anything beyond a couple of fields, a `.skeem.yaml` file is the primary interface.
This is what agents generate, humans review, and repos version-control.

```yaml
# schema/agent-memory.skeem.yaml
name: agent-memory
description: Memory and RAG infrastructure for agent conversations

collections:
  conversations:
    fields:
      title: { type: string }
      model: { type: string, default: "claude-sonnet-4-20250514" }
      started_at: { type: datetime, default: now }
      metadata: { type: json }

  memories:
    fields:
      content: { type: text, required: true }
      summary: { type: string }
      embedding: { type: json }
      memory_type:
        type: string
        default: episodic
        enum: [episodic, semantic, procedural]
      relevance: { type: float, default: 1.0 }
      source_turn: { type: integer }
      created_at: { type: datetime, default: now }
      expires_at: { type: datetime }
    relations:
      conversation_id:
        collection: conversations
        type: m2o

  knowledge_chunks:
    fields:
      content: { type: text, required: true }
      source_uri: { type: string, required: true }
      source_title: { type: string }
      chunk_index: { type: integer }
      embedding: { type: json }
      token_count: { type: integer }
      created_at: { type: datetime, default: now }
      metadata: { type: json }

  tags:
    fields:
      name: { type: string, required: true, unique: true }
      tag_type:
        type: string
        enum: [topic, entity, concept, user-defined]

relations:
  - memories <-> tags
  - memories <-> knowledge_chunks
```

### Applying

```bash
skeem define --from schema/agent-memory.skeem.yaml
```

skeem reads the YAML, builds a dependency graph, and shows the execution plan:

```
Plan: agent-memory
  1. create collection: conversations (4 fields)
  2. create collection: memories (9 fields)
  3. create collection: tags (2 fields)
  4. create collection: knowledge_chunks (7 fields)
  5. create relation: memories.conversation_id -> conversations (m2o)
  6. create junction: memories_tags (m2m: memories <-> tags)
  7. create junction: memories_knowledge_chunks (m2m: memories <-> knowledge_chunks)

Execute? [y/N]
```

With `--json` the plan is structured data. With `--yes` confirmation is skipped.
With `--dry-run` the plan is shown but not executed.

### Idempotent re-apply

On re-apply, skeem diffs the declared schema against the live schema and only
applies changes.

### Destructive changes

Dropping fields or collections requires `--allow-destructive`. Without it,
destructive changes are reported but not executed.

### Field type mapping

| skeem type | Directus type | Supabase/Postgres (future) |
|---|---|---|
| `string` | `string` (varchar) | `text` / `varchar` |
| `text` | `text` | `text` |
| `integer` | `integer` | `integer` / `bigint` |
| `float` | `float` | `real` / `double precision` |
| `boolean` | `boolean` | `boolean` |
| `datetime` | `timestamp` | `timestamptz` |
| `date` | `date` | `date` |
| `json` | `json` | `jsonb` |
| `uuid` | `uuid` | `uuid` |
| `csv` | `csv` | `text[]` |

### Adapter-specific overrides via meta

```yaml
fields:
  embedding:
    type: json                         # Portable skeem type
    meta:
      directus:
        interface: "input-code"
        display: "raw"
      supabase:
        native_type: "vector(1536)"    # pgvector extension
```

---

## 13. Schema Discovery

Discovery goes backend → declaration. The reverse of `define`.

### Full export

```bash
skeem discover                              # To stdout (YAML)
skeem discover -o schema/current.skeem.yaml # To file
skeem discover --json                       # JSON for agents
```

Output is a valid `.skeem.yaml` that can be re-applied with `skeem define`.

### Filtered discovery

```bash
skeem discover people                       # Single collection
skeem discover people companies tags        # Multiple collections
skeem discover people --follow              # Collection + all reachable relations
skeem discover memories --follow --depth 2  # Limit follow depth
```

`--follow` recursively includes every collection reachable through relations.
Essential for agents that only need to understand a subsystem.

### Interactive exploration

```bash
skeem ls                                    # List all collections
skeem ls --counts                           # With record counts
skeem describe people                       # Fields, relations, constraints
skeem describe people companies             # How two collections are related
```

`skeem ls --counts` output:

```
companies         4 fields    127 records
people            5 fields    1,203 records
tags              2 fields    45 records
people_tags       2 fields    3,891 records   (junction)
```

`skeem describe people` output:

```
people
  Fields:
    id          integer     PK, auto-increment
    name        string      required
    email       string      required, unique
    role        string
    hired_at    date
    company_id  integer     -> companies.id (m2o)

  Relations:
    company_id  -> companies (m2o)
    tags        <-> tags (m2m, via people_tags)

  Unique constraints:
    (email)

  Records: 1,203
```

`skeem describe people companies` output (includes cardinality stats):

```
people -> companies
  Type: m2o
  Local field: people.company_id
  Foreign field: companies.id
  Nullable: yes

  Stats:
    people with company:     1,104 / 1,203 (91.7%)
    companies with people:   89 / 127 (70.1%)
    avg people per company:  12.4
```

### Relationship graph visualization

```bash
skeem graph                 # ASCII art (terminal)
skeem graph --mermaid       # Mermaid ER diagram
skeem graph --dot           # DOT format (graphviz)
```

---

## 14. Schema Diffing

Compare a declared `.skeem.yaml` against the live backend:

```bash
skeem diff schema/agent-memory.skeem.yaml
```

```
Comparing schema/agent-memory.skeem.yaml against live backend...

  + live has collection "audit_log" (not in file)
  ~ memories: live has extra field "priority" (integer)
  ~ memories: field "relevance" default differs: file=1.0, live=0.5
  - file declares collection "prompts" (not in live)
  = conversations: match
  = tags: match
```

### Directional diffing

```bash
skeem diff schema/agent-memory.skeem.yaml --direction define    # File is truth
skeem diff schema/agent-memory.skeem.yaml --direction discover  # Live is truth
```

This closes the loop: discover → commit → drift detection → re-define if needed.

---

# Part IV — System Tables and Identity

## 15. System Initialization

```bash
skeem init
```

Provisions all system tables (`skeem_*`) on the connected backend. Safe to re-run —
skeem diffs against existing tables and only creates what's missing.

```bash
skeem init --status    # Show which system tables exist
skeem init --reset     # Drop and re-create (requires --allow-destructive)
```

---

## 16. System Tables

Provisioned by `skeem init`. These are the tables every multi-agent backend needs.

```yaml
collections:
  skeem_aliases:
    fields:
      id: { type: uuid, required: true }
      collection: { type: string, required: true }
      record_id: { type: string, required: true }
      alias: { type: string, required: true }
      alias_normalized: { type: string, required: true }
      created_by: { type: string }
      created_at: { type: datetime, default: now }
    unique:
      - [collection, alias_normalized]

  skeem_tags:
    fields:
      id: { type: uuid, required: true }
      name: { type: string, required: true, unique: true }
      tag_type: { type: string }
      created_at: { type: datetime, default: now }

  skeem_record_tags:
    fields:
      id: { type: uuid, required: true }
      collection: { type: string, required: true }
      record_id: { type: string, required: true }
      tag_id: { type: uuid, required: true }
      created_by: { type: string }
      created_at: { type: datetime, default: now }
    relations:
      tag_id: { collection: skeem_tags, type: m2o }
    unique:
      - [collection, record_id, tag_id]

  skeem_provenance:
    fields:
      id: { type: uuid, required: true }
      collection: { type: string, required: true }
      record_id: { type: string, required: true }
      operation: { type: string, required: true }
      actor: { type: string, required: true }
      actor_type: { type: string, default: agent }
      context: { type: json }
      input_refs: { type: json }
      idempotency_key: { type: string }
      created_at: { type: datetime, default: now }
    unique:
      - [idempotency_key]

  skeem_versions:
    fields:
      id: { type: uuid, required: true }
      collection: { type: string, required: true }
      record_id: { type: string, required: true }
      version: { type: integer, required: true }
      snapshot: { type: json, required: true }
      changed_fields: { type: json }
      provenance_id: { type: uuid }
      created_at: { type: datetime, default: now }
    relations:
      provenance_id: { collection: skeem_provenance, type: m2o }

  skeem_trash:
    fields:
      id: { type: uuid, required: true }
      collection: { type: string, required: true }
      record_id: { type: string, required: true }
      snapshot: { type: json, required: true }
      deleted_by: { type: string }
      provenance_id: { type: uuid }
      deleted_at: { type: datetime, default: now }
      expires_at: { type: datetime }
    relations:
      provenance_id: { collection: skeem_provenance, type: m2o }

  skeem_claims:
    fields:
      id: { type: uuid, required: true }
      collection: { type: string, required: true }
      record_id: { type: string, required: true }
      claimed_by: { type: string, required: true }
      purpose: { type: string }
      lease_until: { type: datetime, required: true }
      created_at: { type: datetime, default: now }
    unique:
      - [collection, record_id]

  skeem_annotations:
    fields:
      id: { type: uuid, required: true }
      collection: { type: string, required: true }
      record_id: { type: string, required: true }
      key: { type: string, required: true }
      value: { type: json, required: true }
      actor: { type: string }
      created_at: { type: datetime, default: now }
      expires_at: { type: datetime }

  skeem_extensions:
    fields:
      id: { type: uuid, required: true }
      name: { type: string, required: true, unique: true }
      version: { type: string, required: true }
      schema_hash: { type: string }
      installed_at: { type: datetime, default: now }
      installed_by: { type: string }
```

---

## 17. Identity Resolution and Aliases

Every `?` and `??` query checks aliases after checking the collection's own fields.

Resolution order:
1. Exact match on the target field (e.g., `companies.name = "Acme Corp"`)
2. Exact match on normalized alias (`skeem_aliases` where `collection = "companies"` and `alias_normalized` matches)
3. No match → error (for `?`) or create (for `??`)

Normalization: lowercase, strip punctuation, collapse whitespace, strip common
suffixes (Inc., LLC, Corp., Ltd., etc. — configurable).

### CLI commands

```bash
# Add an alias
skeem alias add companies:42 "ACME Inc."
skeem alias add companies:42 "A.C.M.E Inc."
skeem alias add companies:42 "Acme Corporation"

# List aliases for a record
skeem alias list companies:42

# Remove an alias
skeem alias remove companies:42 "ACME Inc."

# Search aliases
skeem alias search companies "acme"
```

All aliases are stored in the shared backend, so every agent and skeem instance
sees them immediately.

---

## 18. Provenance Tracking

Every write operation (create, update, delete, link, unlink) automatically inserts
a `skeem_provenance` record.

The `actor` is derived from `--actor` flag or config. The `context` can be passed
via `--context '{"task_id": "42"}'`.

```bash
# Explicitly tagged
skeem create companies --name "Acme" --actor assistant-1 --context '{"task": "onboarding"}'

# Query provenance
skeem find skeem_provenance --where collection=companies --where record_id=42 --json
```

---

## 19. Versioning and Soft Delete

### Automatic versioning

Every `skeem update` snapshots the previous record state into `skeem_versions`
before applying the change.

```bash
# View version history
skeem find skeem_versions --where collection=companies --where record_id=42 --sort -version --json
```

### Soft delete

`skeem delete` moves the record to `skeem_trash` instead of hard-deleting.

```bash
skeem delete companies 42                  # Soft delete (to trash)
skeem delete companies 42 --hard           # Permanent delete (bypasses trash)
skeem restore companies 42                 # Recover from trash
```

Trash auto-purges based on `expires_at` (default: 30 days, configurable).

---

## 20. Agent Coordination (Claims)

Lightweight lease-based coordination for concurrent agents.

```bash
skeem claim tasks:17 --actor assistant-1 --lease 5m --purpose "processing"
skeem claims tasks:17                      # Check if claimed
skeem release tasks:17 --actor assistant-1 # Release early
```

Expired leases are automatically ignored. Only one active claim per record.

---

## 21. Annotations

Metadata *about* records that doesn't pollute the data schema.

```bash
skeem annotate companies:42 --key "quality_score" --value '0.85' --actor assistant-1
skeem annotate companies:42 --key "note" --value '"Email bounced 2026-03-15"' --actor assistant-2

# Read annotations
skeem find skeem_annotations --where collection=companies --where record_id=42 --json
```

Annotations support TTL via `--expires`.

---

## 22. Idempotency

Any write operation can include `--idempotency-key <key>`. If that key already
exists in `skeem_provenance`, the operation is skipped and the original result
is returned.

```bash
skeem create companies --name "Acme" --idempotency-key "task-42-step-1" --json
# Run again: returns the original result without creating a duplicate
skeem create companies --name "Acme" --idempotency-key "task-42-step-1" --json
```

---

# Part V — Extension System

## 23. Extension Architecture

Extensions are opt-in domain schemas installed via `skeem extend <name>`.

```bash
skeem extend memory                     # Install memory extension
skeem extend kg                         # Install knowledge graph extension
skeem extend list                       # Show available extensions
skeem extend status                     # Show installed extensions
```

### Extension structure

```
@skeems/extend-memory/
├── skeem-extension.yaml              # Manifest
├── schema.skeem.yaml                 # Collections to provision
├── src/
│   ├── index.ts                      # Custom CLI commands
│   ├── scoping.ts                    # Query middleware
│   └── maintenance.ts                # Background tasks
└── package.json
```

### Manifest

```yaml
# skeem-extension.yaml
name: memory
version: 0.1.0
description: Agent memory system with scoped access and conversation tracking
requires:
  skeem: ">=0.1.0"
  system_tables: true
depends_on: []
cli_commands:
  - remember
  - recall
  - forget
  - reinforce
```

Installation provisions collections via `skeem define`, registers in
`skeem_extensions` table, and loads custom CLI commands.

---

## 24. Memory Extension

### Design principles

1. **Scoped by default.** Every memory has an owner. Queries are scoped automatically.
2. **Conversational context.** Memories organized by conversations and turns.
3. **Typed memories.** Episodic, semantic, procedural, and working memories with
   different lifecycles.
4. **Decay and reinforcement.** Relevance scores decay over time and are reinforced
   by access.

### Schema

```yaml
# @skeems/extend-memory/schema.skeem.yaml
name: skeem-memory

collections:
  skeem_mem_spaces:
    fields:
      id: { type: uuid, required: true }
      name: { type: string, required: true }
      description: { type: string }
      space_type:
        type: string
        required: true
        enum: [private, shared, public]
      owner: { type: string }
      created_at: { type: datetime, default: now }
    unique:
      - [name, owner]

  skeem_mem_access:
    fields:
      id: { type: uuid, required: true }
      space_id: { type: uuid, required: true }
      actor: { type: string, required: true }
      actor_type: { type: string, default: agent }
      permission: { type: string, default: read }
      granted_by: { type: string }
      granted_at: { type: datetime, default: now }
    relations:
      space_id: { collection: skeem_mem_spaces, type: m2o }
    unique:
      - [space_id, actor]

  skeem_mem_conversations:
    fields:
      id: { type: uuid, required: true }
      space_id: { type: uuid, required: true }
      title: { type: string }
      model: { type: string }
      actor: { type: string, required: true }
      status:
        type: string
        default: active
        enum: [active, archived, deleted]
      metadata: { type: json }
      started_at: { type: datetime, default: now }
      ended_at: { type: datetime }
    relations:
      space_id: { collection: skeem_mem_spaces, type: m2o }

  skeem_mem_entries:
    fields:
      id: { type: uuid, required: true }
      space_id: { type: uuid, required: true }
      conversation_id: { type: uuid }
      content: { type: text, required: true }
      summary: { type: string }
      memory_type:
        type: string
        required: true
        enum: [episodic, semantic, procedural, working]
      relevance: { type: float, default: 1.0 }
      access_count: { type: integer, default: 0 }
      last_accessed_at: { type: datetime }
      source_turn: { type: integer }
      actor: { type: string, required: true }
      embedding: { type: json }
      metadata: { type: json }
      created_at: { type: datetime, default: now }
      expires_at: { type: datetime }
      archived_at: { type: datetime }
    relations:
      space_id: { collection: skeem_mem_spaces, type: m2o }
      conversation_id: { collection: skeem_mem_conversations, type: m2o }

  skeem_mem_entry_links:
    fields:
      id: { type: uuid, required: true }
      source_id: { type: uuid, required: true }
      target_id: { type: uuid, required: true }
      link_type:
        type: string
        required: true
        enum: [reinforces, contradicts, supersedes, derives_from, related]
      strength: { type: float, default: 1.0 }
      created_by: { type: string }
      created_at: { type: datetime, default: now }
    relations:
      source_id: { collection: skeem_mem_entries, type: m2o }
      target_id: { collection: skeem_mem_entries, type: m2o }

relations:
  - skeem_mem_entries <-> skeem_tags
```

### Access scoping

When an agent calls `skeem recall`, the extension:

1. Identifies the caller's actor ID (from `--actor` or config).
2. Finds all spaces where the actor has access (via `skeem_mem_access` + public
   spaces + spaces where `owner = actor`).
3. Filters `skeem_mem_entries` to only those space IDs.

An agent never has to think about access control — it calls `skeem recall` and
gets back everything it's allowed to see.

### CLI commands

```bash
# Store a memory
skeem remember \
  --actor assistant-1 \
  --space "assistant-1-private" \
  --content "User prefers bullet points for lists but prose for explanations" \
  --type procedural \
  --conversation $CONV_ID \
  --tag "user-preference" \
  --json

# Recall memories (auto-scoped)
skeem recall \
  --actor assistant-1 \
  --type procedural \
  --search "formatting" \
  --top 5 \
  --json

# Forget (soft delete via system trash)
skeem forget $MEMORY_ID --actor assistant-1

# Reinforce (bump relevance, update access count)
skeem reinforce $MEMORY_ID

# Link two memories
skeem remember-link $MEM_A $MEM_B --type reinforces

# Manage spaces
skeem memory space create "team-shared" --type shared
skeem memory space grant "team-shared" --actor assistant-2 --permission write
skeem memory space list --actor assistant-1

# Run lifecycle maintenance (cron or agent-triggered)
skeem memory maintain
```

### Typical multi-agent setup

```
Spaces:
  assistant-1-private (private)     234 entries
  assistant-2-private (private)      89 entries
  team-shared (shared)              412 entries
    Access: assistant-1 (write), assistant-2 (write), human-brent (admin)
  global-knowledge (public)       1,203 entries (semantic only)
```

An agent's effective memory is the union of its private space, all shared spaces
it has access to, and all public spaces.

### Lifecycle management

- **Working memory expiry**: Type `working` auto-expires after configurable TTL.
- **Relevance decay**: Unaccessed memories have relevance decremented periodically.
- **Access reinforcement**: Each `recall` increments `access_count` and updates
  `last_accessed_at`.
- **Deduplication**: On `remember`, checks for near-duplicate content in the same space.

---

## 25. Knowledge Graph Extension

### Design principles

1. **SQL-native.** Nodes and edges in regular tables. Good enough for <100K nodes.
2. **Typed edges.** "Person WORKS_AT Company" and "Person FOUNDED Company" are different.
3. **Composable with memory.** Memories can be linked to KG nodes as evidence.
4. **Agent-writable.** Agents build and maintain the graph as they learn.

### Schema

```yaml
# @skeems/extend-kg/schema.skeem.yaml
name: skeem-kg

collections:
  skeem_kg_nodes:
    fields:
      id: { type: uuid, required: true }
      node_type: { type: string, required: true }
      name: { type: string, required: true }
      description: { type: string }
      properties: { type: json }
      canonical: { type: boolean, default: true }
      embedding: { type: json }
      source_collection: { type: string }
      source_record_id: { type: string }
      actor: { type: string }
      confidence: { type: float, default: 1.0 }
      created_at: { type: datetime, default: now }
      updated_at: { type: datetime, default: now }
    unique:
      - [node_type, name]

  skeem_kg_edges:
    fields:
      id: { type: uuid, required: true }
      source_id: { type: uuid, required: true }
      target_id: { type: uuid, required: true }
      edge_type: { type: string, required: true }
      properties: { type: json }
      weight: { type: float, default: 1.0 }
      bidirectional: { type: boolean, default: false }
      actor: { type: string }
      confidence: { type: float, default: 1.0 }
      valid_from: { type: datetime }
      valid_until: { type: datetime }
      created_at: { type: datetime, default: now }
    relations:
      source_id: { collection: skeem_kg_nodes, type: m2o }
      target_id: { collection: skeem_kg_nodes, type: m2o }

  skeem_kg_node_sources:
    fields:
      id: { type: uuid, required: true }
      node_id: { type: uuid, required: true }
      source_type:
        type: string
        required: true
        enum: [memory, record, manual, inference, import]
      source_ref: { type: string }
      excerpt: { type: text }
      confidence: { type: float, default: 1.0 }
      actor: { type: string }
      created_at: { type: datetime, default: now }
    relations:
      node_id: { collection: skeem_kg_nodes, type: m2o }

relations:
  - skeem_kg_nodes <-> skeem_tags
```

### CLI commands

```bash
# Add nodes and edges
skeem kg add node "Acme Corp" --type company --properties '{"industry":"Tech"}'
skeem kg add edge "Jane Doe" --type WORKS_AT --target "Acme Corp" --properties '{"role":"CTO"}'

# Query
skeem kg edges "Acme Corp" --json
skeem kg nodes --type person --json
skeem kg traverse "Jane Doe" --depth 2 --json
skeem kg path "Jane Doe" "Bob Smith" --max-depth 4 --json

# Temporal queries
skeem kg edges "Jane Doe" --type WORKS_AT --at "2023-06-15" --json

# Merge duplicates
skeem kg merge @node-1 @node-2 --keep @node-1

# Link to source evidence
skeem kg source @node-uuid --type memory --ref $MEMORY_ID \
  --excerpt "User mentioned Acme Corp is their employer"

# Visualize
skeem kg graph --mermaid
skeem kg graph --root "Acme Corp" --depth 2 --dot
```

### Cross-extension integration

When both `memory` and `kg` extensions are installed:

```bash
skeem remember \
  --content "Met with Jane from Acme Corp, she's their new CTO" \
  --type episodic \
  --extract-entities \
  --json
```

`--extract-entities` sends content to configured LLM for entity extraction,
then writes results to the KG with source links back to the memory entry.

---

## 26. Extension Registry and Third-Party Extensions

### Built-in extensions

| Extension | Package | Description |
|---|---|---|
| `memory` | `@skeems/extend-memory` | Scoped agent memory with conversations and lifecycle |
| `kg` | `@skeems/extend-kg` | Lightweight SQL knowledge graph |

### Planned extensions

| Extension | Description |
|---|---|
| `rag` | Document chunking, embedding management, retrieval |
| `tasks` | Task queues with assignment, priority, dependencies |
| `prompts` | Prompt versioning, A/B testing, performance tracking |
| `audit` | Detailed audit trail with diff-level change tracking |

### Third-party extensions

```bash
skeem extend @someorg/extend-custom-crm
skeem extend git+https://github.com/user/skeem-extend-inventory.git
```

Contract: must include `skeem-extension.yaml` manifest, `schema.skeem.yaml` with
collections prefixed `skeem_{ext}_*`, and optionally TypeScript source for custom
CLI commands and middleware.

---

# Part VI — Agent Integration

## 27. Agent Tool Schema Generation

Auto-generate LLM tool definitions from the discovered schema.

```bash
skeem tools --format openai > tools.json
skeem tools --format anthropic > tools.json
skeem tools --format openai --collections people,companies,tags > tools.json
skeem tools --format openai --include-schema > tools.json  # Include define/discover tools
```

### Generated tool structure

For each collection, skeem generates create/find/get/update/delete tool definitions
with parameter schemas derived from field types, required flags, and relation metadata.

Example (OpenAI format):

```json
[
  {
    "type": "function",
    "function": {
      "name": "skeem_create_people",
      "description": "Create a new record in the people collection. Fields: name (string, required), email (string, required), role (string). Relations: company (m2o -> companies).",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Required" },
          "email": { "type": "string", "description": "Required" },
          "role": { "type": "string" },
          "company": { "type": ["string", "integer"], "description": "Relation to companies. Use ID, ?field=value to resolve, or ??field=value to resolve-or-create." }
        },
        "required": ["name", "email"]
      }
    }
  }
]
```

### Integration loop

```
Agent calls tool: skeem_create_people({ name: "Jane", company: "?name=Acme" })
    ↓
Runtime translates to: skeem create people --name "Jane" --company ?name="Acme" --json
    ↓
Runtime parses JSON output and returns to agent
```

---

## 28. Output Contract

Every skeem command returns a consistent JSON envelope when `--json` is active
(or when stdout is piped).

### Success — single operation

```json
{
  "ok": true,
  "operation": "create",
  "collection": "companies",
  "data": { "id": 42, "name": "Acme", "industry": "Tech" }
}
```

### Success — compound operation

```json
{
  "ok": true,
  "operation": "compound_create",
  "plan": [
    { "ref": "company", "operation": "create", "collection": "companies", "data": { "id": 42, "name": "Acme Corp" } },
    { "ref": "root", "operation": "create", "collection": "person", "data": { "id": 17, "name": "Jane", "company_id": 42 } }
  ]
}
```

### Success — find

```json
{
  "ok": true,
  "operation": "find",
  "collection": "people",
  "data": [ { "id": 17, "name": "Jane" }, { "id": 18, "name": "Bob" } ],
  "count": 2
}
```

### Success — upsert

```json
{
  "ok": true,
  "operation": "upsert",
  "action": "updated",
  "collection": "companies",
  "data": { "id": 42, "name": "Acme Corp", "industry": "Technology" }
}
```

### Failure

```json
{
  "ok": false,
  "operation": "create",
  "collection": "people",
  "error": { "code": "VALIDATION", "field": "email", "message": "email is required" }
}
```

### Human-readable output

When stdout is a TTY, skeem uses a compact human-readable format with colored
status indicators, tabular data for `find` results, and clear error messages.

---

# Part VII — Platform Surfaces

## 29. skeem-fs: FUSE Filesystem

Mount a headless data backend as a filesystem. Collections become directories,
records become files, fields become file contents.

### Filesystem layout

```
/mnt/skeem/
├── .schema/                           # Virtual: schema metadata
│   ├── collections.json
│   └── graph.mermaid
│
├── companies/
│   ├── .schema.json                   # Collection schema
│   ├── 42.json                        # Record as JSON
│   ├── 42/                            # Expanded view
│   │   ├── _record.json
│   │   ├── name                       # Plain text field value
│   │   ├── industry
│   │   └── people/                    # O2M relation (symlinks)
│   │       ├── 17.json -> ../../people/17.json
│   │       └── 18.json -> ../../people/18.json
│   ├── _new.json                      # Write here to create
│   └── _query/                        # Virtual query interface
│       └── name=Acme Corp.json
│
├── people/
│   ├── .schema.json
│   ├── 17.json
│   ├── 17/
│   │   ├── _record.json
│   │   ├── name
│   │   └── company/ -> ../../companies/42
│   └── _new.json
│
└── .events                            # Newline-delimited JSON event stream
```

### Operations mapped to filesystem

| Filesystem | skeem equivalent |
|---|---|
| `ls /mnt/skeem/` | `skeem ls` |
| `ls /mnt/skeem/companies/` | `skeem find companies` |
| `cat companies/42.json` | `skeem get companies 42` |
| `cat companies/42/name` | Field access |
| `echo '{"name":"X"}' > companies/_new.json` | `skeem create companies --name X` |
| `echo '{"name":"Y"}' > companies/42.json` | `skeem update companies 42 --name Y` |
| `rm companies/42.json` | `skeem delete companies 42` |
| `cat companies/_query/name=Acme.json` | `skeem find companies --where name=Acme` |

### Caching

- Read cache with configurable TTL (memory + optional disk).
- Write-through: writes go to API immediately, update local cache on success.
- Schema cached with long TTL.

### Live events via Directus WebSocket

Directus WebSocket subscriptions enable:

1. **Cache invalidation**: Record changes on server → WebSocket event → evict from cache.
2. **inotify events**: Filesystem watchers see changes in real time.
3. **Event stream**: `tail -f /mnt/skeem/.events` for newline-delimited JSON events.

```bash
# Watch for new records
inotifywait -m /mnt/skeem/memories/ -e create | while read event; do
  echo "New memory: $event"
done

# React to changes from other agents
fswatch /mnt/skeem/tasks/ | while read path; do
  cat "$path" | process-task
done
```

### Why it matters

Agents that operate via file manipulation primitives (`read_file`, `write_file`,
`list_directory`) can interact with structured data backends without new tool
definitions. The UNIX piping pattern is genuinely powerful:

```bash
cat /mnt/skeem/companies/_query/industry=Technology.json \
  | jq -r '.[].id' \
  | xargs -I{} ls /mnt/skeem/companies/{}/people/ \
  | xargs cat | jq -s 'flatten | map(select(.role == "CTO"))'
```

### Implementation

- Language: Rust or Go (FUSE bindings: `fuser` crate or `bazil/fuse`).
- Wraps skeem adapter behind FUSE syscall handlers.
- Mount: `skeem-fs mount /mnt/skeem --profile dev`

---

## 30. skeem-swift-app: Apple Ecosystem Client

A native Apple app (iOS, iPadOS, macOS) that manages multiple skeem-compatible
backends with local caching, offline support, and App Intents for Shortcuts/Siri.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SwiftUI Interface                      │
│  Connection manager, collection browser, record editor    │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                    App Intents Layer                      │
│  Shortcuts / Siri / Spotlight / Action Button             │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                     skeem-swift core                      │
│  Operation grammar (same semantics as CLI)                │
│  Relation resolver, sync engine, conflict resolution      │
└────────┬───────────────────────────────────┬────────────┘
         │                                   │
┌────────▼────────┐                ┌─────────▼───────────┐
│  Local Store     │                │  Remote Adapter      │
│  SwiftData       │◄──── sync ────►│  Directus REST API   │
│                  │                │  (+ WebSocket)       │
└─────────────────┘                └─────────────────────┘
```

### Multi-instance management

The app manages connections to multiple backends, each with its own local store,
sync state, and Keychain-stored credentials.

### Sync engine

- **Pull**: Incremental via `?filter[date_updated][_gt]=<timestamp>`. WebSocket for
  real-time push when active.
- **Push**: Local changes queued in sync log, replayed when online.
- **Conflicts**: Configurable — `remote-wins` (default), `local-wins`, `manual`,
  `field-level-merge`.

### App Intents

Every skeem verb maps to an App Intent, making operations available to Siri,
Shortcuts, Spotlight, Action Button, Focus Filters, and Widgets.

```swift
struct CreateRecordIntent: AppIntent {
    static var title: LocalizedStringResource = "Create Record"
    static var openAppWhenRun = false

    @Parameter(title: "Instance") var instance: InstanceEntity
    @Parameter(title: "Collection") var collection: CollectionEntity
    @Parameter(title: "Fields") var fields: [FieldValueEntity]

    func perform() async throws -> some IntentResult & ReturnsValue<RecordEntity> {
        let adapter = try await SkemSwift.adapter(for: instance)
        let data = fields.reduce(into: [:]) { $0[$1.name] = $1.value }
        let record = try await adapter.create(collection.name, data: data)
        return .result(value: RecordEntity(from: record))
    }
}

struct FindRecordsIntent: AppIntent {
    static var title: LocalizedStringResource = "Find Records"

    @Parameter(title: "Instance") var instance: InstanceEntity
    @Parameter(title: "Collection") var collection: CollectionEntity
    @Parameter(title: "Search field") var filterField: String
    @Parameter(title: "Search value") var filterValue: String
    @Parameter(title: "Limit", default: 10) var limit: Int

    func perform() async throws -> some IntentResult & ReturnsValue<[RecordEntity]> {
        let adapter = try await SkemSwift.adapter(for: instance)
        let records = try await adapter.find(collection.name, filter: [filterField: filterValue], options: FindOptions(limit: limit))
        return .result(value: records.map { RecordEntity(from: $0) })
    }
}

struct AddMemoryIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Memory"
    static var openAppWhenRun = false

    @Parameter(title: "Content") var content: String
    @Parameter(title: "Type", default: .episodic) var memoryType: MemoryTypeEnum
    @Parameter(title: "Instance") var instance: InstanceEntity

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let adapter = try await SkemSwift.adapter(for: instance)
        let record = try await adapter.create("skeem_mem_entries", data: [
            "content": content,
            "memory_type": memoryType.rawValue,
            "created_at": ISO8601DateFormatter().string(from: Date())
        ])
        return .result(dialog: "Memory saved")
    }
}
```

### Example Shortcuts

- **"Morning Standup"**: Find in-progress tasks → format → read aloud via Siri
- **"Quick CRM Note"**: Ask company name → find → ask note → create linked note
- **"Store Observation"** (Action Button): Dictate → Add Memory → done

### Spotlight integration

Records indexed via `CSSearchableItem`, searchable across all connected instances.

### Widgets

WidgetKit widgets for collection counters, recent records, and instance status.

### Technology

SwiftUI, SwiftData, URLSession, Combine/AsyncStream, Keychain, App Intents,
WidgetKit, Core Spotlight. Optional CloudKit for syncing instance configurations
(not data) across Apple devices.

### Why it matters

App Intents transform skeem from a developer tool into a platform. Non-developers
build Shortcuts that create CRM entries from dictation. The Action Button becomes
a physical data input device. Focus Filters scope which instances are visible.
This is structurally the Runcible interface layer — a personal data tool on your
device, caching locally, speaking to backends you control, activated by voice
and gesture.

---

# Part VIII — Adapter Interfaces and Types

## 31. Adapter Interface — Data

```typescript
interface SkemAdapter {
  readonly name: string;

  connect(config: AdapterConfig): Promise<void>;
  introspect(): Promise<Schema>;
  create(collection: string, data: Record<string, unknown>): Promise<EntityRecord>;
  get(collection: string, id: PrimaryKey, options?: GetOptions): Promise<EntityRecord>;
  find(collection: string, filter: Filter, options?: FindOptions): Promise<EntityRecord[]>;
  findOne(collection: string, filter: Filter): Promise<EntityRecord>;
  update(collection: string, id: PrimaryKey, data: Record<string, unknown>): Promise<EntityRecord>;
  delete(collection: string, id: PrimaryKey): Promise<void>;

  // Optional: batch create for performance
  createMany?(collection: string, data: Record<string, unknown>[]): Promise<EntityRecord[]>;
}

interface GetOptions {
  expand?: string[];
}

interface FindOptions {
  limit?: number;
  offset?: number;
  sort?: string;
  expand?: string[];
}
```

---

## 32. Adapter Interface — Schema

Optional. Enables `skeem define`.

```typescript
interface SkemSchemaAdapter {
  createCollection(definition: CollectionDefinition): Promise<CollectionMeta>;
  createField(collection: string, field: FieldDefinition): Promise<FieldMeta>;
  updateField(collection: string, field: string, changes: Partial<FieldDefinition>): Promise<FieldMeta>;
  deleteField(collection: string, field: string): Promise<void>;
  createRelation(relation: RelationDefinition): Promise<RelationMeta>;
  deleteCollection(collection: string): Promise<void>;
}
```

---

## 33. Adapter Interface — Discovery

Augments `introspect()` with richer queries for exploration.

```typescript
interface SkemDiscoveryAdapter {
  count(collection: string): Promise<number | null>;
  relationStats?(collection: string, relatedCollection: string, relation: Relation): Promise<RelationStats | null>;
}

interface RelationStats {
  localTotal: number;
  localWithRelation: number;
  foreignTotal: number;
  foreignWithRelation: number;
  avgPerForeign: number;
}
```

---

## 34. Shared Types

```typescript
// --- Schema types ---

interface Schema {
  collections: Map<string, Collection>;
}

interface Collection {
  name: string;
  primaryKey: string;
  fields: Map<string, Field>;
  relations: Relation[];
  uniqueConstraints: UniqueConstraint[];
}

interface Field {
  name: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  default?: unknown;
  enum?: string[];
}

type FieldType = 'string' | 'text' | 'integer' | 'float' | 'boolean'
  | 'datetime' | 'date' | 'json' | 'uuid' | 'csv';

interface Relation {
  type: 'm2o' | 'o2m' | 'm2m';
  field: string;
  relatedCollection: string;
  relatedField: string;
  junctionCollection?: string;
  junctionLocalField?: string;
  junctionForeignField?: string;
}

interface UniqueConstraint {
  fields: string[];
}

// --- Definition types ---

interface CollectionDefinition {
  name: string;
  fields: FieldDefinition[];
  meta?: { icon?: string; color?: string; note?: string; sort_field?: string; };
}

interface FieldDefinition {
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  enum?: string[];
  meta?: { interface?: string; display?: string; note?: string; width?: 'half' | 'full'; [key: string]: unknown; };
}

interface RelationDefinition {
  type: 'm2o' | 'o2m' | 'm2m';
  collection: string;
  field: string;
  relatedCollection: string;
  junctionCollection?: string;
}

// --- Query types ---

interface Filter { [field: string]: FilterValue; }
type FilterValue = string | number | boolean | null;
interface EntityRecord { [field: string]: unknown; }
type PrimaryKey = string | number;

// --- Config types ---

interface AdapterConfig {
  url: string;
  token?: string;
  [key: string]: unknown;
}
```

---

## 35. Error Types

```typescript
class SkemError extends Error { code: string; }
class NotFoundError extends SkemError { code = 'NOT_FOUND'; collection: string; id?: PrimaryKey; filter?: Filter; }
class AmbiguousError extends SkemError { code = 'AMBIGUOUS'; collection: string; filter: Filter; count: number; }
class DuplicateError extends SkemError { code = 'DUPLICATE'; collection: string; constraint: string[]; }
class ValidationError extends SkemError { code = 'VALIDATION'; collection: string; field: string; }
class AuthError extends SkemError { code = 'AUTH'; }
class SchemaUnsupportedError extends SkemError { code = 'SCHEMA_UNSUPPORTED'; }
class RelationNotFoundError extends SkemError { code = 'RELATION_NOT_FOUND'; collection: string; path: string; }
class CacheStaleError extends SkemError { code = 'CACHE_STALE'; }
```

---

# Part IX — Operations and Deployment

## 36. Rollback Strategy

Headless backends generally don't support cross-collection transactions.
skeem core implements best-effort rollback:

1. Execute operations in dependency order, recording each success.
2. On failure, attempt to delete previously created entities in reverse order.
3. Report full state: what succeeded, what failed, what was rolled back.

```json
{
  "ok": false,
  "error": { "code": "VALIDATION", "message": "email is required", "collection": "person" },
  "completed": [
    { "ref": "company", "operation": "create", "collection": "companies", "data": { "id": 42 }, "rolled_back": true }
  ],
  "failed": { "ref": "root", "operation": "create", "collection": "person" }
}
```

`--no-rollback` preserves partial state for manual inspection.

---

## 37. Directus Adapter Reference

### Data operations

| Adapter method | Directus API endpoint |
|---|---|
| `connect` | `GET /server/info` |
| `introspect` | `GET /collections` + `GET /fields` + `GET /relations` |
| `create` | `POST /items/:collection` |
| `createMany` | `POST /items/:collection` (array body) |
| `get` | `GET /items/:collection/:id` |
| `get` (expand) | `GET /items/:collection/:id?fields=*,relation.*` |
| `find` | `GET /items/:collection?filter[field][_eq]=value` |
| `findOne` | `find` + assert exactly 1 result |
| `update` | `PATCH /items/:collection/:id` |
| `delete` | `DELETE /items/:collection/:id` |

### Schema operations

| Adapter method | Directus API endpoint(s) |
|---|---|
| `createCollection` | `POST /collections` + `POST /fields/:collection` per field |
| `createField` | `POST /fields/:collection` |
| `updateField` | `PATCH /fields/:collection/:field` |
| `deleteField` | `DELETE /fields/:collection/:field` |
| `createRelation` (m2o) | `POST /fields` (FK) + `POST /relations` |
| `createRelation` (m2m) | Create junction collection + 2 FK fields + 2 relations |
| `deleteCollection` | `DELETE /collections/:collection` |

### Discovery operations

| Adapter method | Directus API endpoint |
|---|---|
| `count` | `GET /items/:collection?aggregate[count]=id` |
| `relationStats` | Multiple aggregate queries |

### Directus-specific behavior

- Exclude `directus_*` system collections from introspection by default.
- Map Directus relation metadata into skeem's normalized `Relation` type.
- Handle token types: static token, temporary JWT with refresh.
- Filter internal fields (`sort`, `user_created`, etc.) unless `--include-system-fields`.

---

## 38. Permissions and Partial Visibility

When a token has limited permissions, `introspect()` returns a partial view.
skeem surfaces this:

```json
{
  "warnings": [
    "Token role 'editor' may not have access to all collections. Schema may be incomplete."
  ]
}
```

If a `create` fails due to an invisible required field:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION",
    "message": "Server rejected the request. Field 'internal_code' may be required but is not visible to your token's role.",
    "hint": "Use an admin token or check field permissions."
  }
}
```

`skeem discover --warn-partial` flags potential gaps.

---

## 39. Testing Strategy

### Adapter conformance suite

skeem core provides a shared test suite that validates any adapter:

```typescript
export function runConformanceSuite(adapter: SkemAdapter & Partial<SkemSchemaAdapter>) {
  describe('Data operations', () => {
    test('create and get', ...);
    test('findOne with no results throws NotFoundError', ...);
    test('findOne with multiple results throws AmbiguousError', ...);
    test('create with duplicate throws DuplicateError', ...);
    // ...
  });
  describe('Schema operations', () => {
    test('createCollection', ...);
    test('createRelation m2m creates junction', ...);
    // ...
  });
}
```

### Directus test environment

```yaml
# test/docker-compose.yaml
services:
  directus:
    image: directus/directus:latest
    ports: ["8055:8055"]
    environment:
      ADMIN_EMAIL: admin@test.local
      ADMIN_PASSWORD: testpassword
      DB_CLIENT: sqlite3
      DB_FILENAME: /directus/database/test.db
```

### Core logic tests

Unit tests with mock adapters for: operation parser, dependency resolver, schema
diff engine, output formatter, cache manager, tool schema generator.

---

# Part X — Reference

## 40. Full CLI Verb Summary

### Core verbs

| Verb | Domain | Purpose |
|---|---|---|
| `init` | system | Provision system tables |
| `create` | data | Create record with relation resolution |
| `get` | data | Read record by ID |
| `find` | data | Query records by filter |
| `update` | data | Update record by ID |
| `delete` | data | Soft delete (to trash) |
| `delete --hard` | data | Permanent delete |
| `restore` | data | Recover from trash |
| `upsert` | data | Find-or-create-or-update |
| `link` | data | Create M2M junction |
| `unlink` | data | Remove M2M junction |
| `exec` | data | Execute JSON operation plan from stdin |
| `define` | schema | Apply schema file to backend |
| `discover` | schema | Export backend schema to `.skeem.yaml` |
| `ls` | schema | List collections |
| `describe` | schema | Describe collection(s) and relations |
| `graph` | schema | Visualize relational graph |
| `diff` | schema | Compare declared vs. live schema |
| `tools` | agent | Generate LLM tool definitions |
| `cache` | meta | Manage schema cache (`clear`, `show`) |
| `extend` | meta | Install/manage extensions |
| `alias` | identity | Manage record aliases |
| `claim` | coord | Acquire/release record lease |
| `release` | coord | Release a claim |
| `annotate` | meta | Add annotation to record |

### Memory extension verbs

| Verb | Purpose |
|---|---|
| `remember` | Store a memory entry |
| `recall` | Query memories (auto-scoped) |
| `forget` | Soft-delete a memory |
| `reinforce` | Bump memory relevance |
| `remember-link` | Link two memory entries |
| `memory space` | Manage spaces and access |
| `memory maintain` | Run lifecycle maintenance |

### Knowledge graph extension verbs

| Verb | Purpose |
|---|---|
| `kg add node` | Create a KG node |
| `kg add edge` | Create a KG edge |
| `kg edges` | Query edges from/to a node |
| `kg nodes` | Query nodes by type/filter |
| `kg traverse` | BFS/DFS traversal |
| `kg path` | Find paths between nodes |
| `kg merge` | Merge duplicate nodes |
| `kg source` | Link node to source evidence |
| `kg graph` | Visualize subgraph |

---

## 41. Implementation Priorities

### Phase 1 — MVP

Enough to be useful for a single developer or agent against one Directus instance.

1. Project scaffolding: monorepo, TypeScript build, CLI entrypoint.
2. Config loading: `.skeemrc.yaml`, env var interpolation, CLI flag overrides.
3. Directus adapter — data: `connect`, `introspect`, `create`, `get`, `find`, `findOne`, `update`, `delete`.
4. Schema caching: local cache, TTL-based invalidation.
5. Relation resolution: dot notation, `@`, `?`, `??` parsing and execution.
6. Compound operation executor: dependency graph resolution, ordered execution.
7. Rollback: best-effort on compound failure.
8. Output contract: JSON envelope for all operations, human-readable TTY output.
9. Basic discovery: `skeem ls`, `skeem describe`, `skeem discover` (YAML export).
10. `--json` everywhere.

### Phase 2 — Schema management

1. Directus adapter — schema: `createCollection`, `createField`, `updateField`, `deleteField`, `createRelation` (including M2M junction generation), `deleteCollection`.
2. `skeem define`: YAML parsing, dependency graph, execution planning.
3. `skeem diff`: schema comparison engine, directional diffing.
4. Idempotent re-apply: diff-based `define` that only applies changes.
5. `skeem upsert`: top-level find-or-create-or-update.
6. `skeem link` / `skeem unlink`: M2M sugar.

### Phase 3 — System tables and identity

1. `skeem init`: provision system tables.
2. `skeem_aliases` and identity resolution integrated into `?` / `??` notation.
3. `skeem_provenance`: automatic tracking on all write operations.
4. `skeem_versions`: automatic snapshots on update.
5. `skeem_trash`: soft delete, `skeem restore`.
6. `skeem_claims`: lease-based coordination.
7. `skeem_annotations`: record metadata.
8. Idempotency keys.

### Phase 4 — Agent integration

1. `skeem tools`: auto-generate tool definitions (OpenAI and Anthropic formats).
2. `skeem exec`: full pipe mode with `$ref` variable resolution and DAG execution.
3. Bulk operations: `createMany` in adapter, batch detection in `exec`.
4. Nested reads: `--expand` flag.
5. `skeem graph`: Mermaid and DOT output.
6. Relation stats: `skeem describe <a> <b>` with cardinality statistics.

### Phase 5 — Extensions

1. Extension loader and registry.
2. Memory extension: spaces, access, conversations, entries, lifecycle.
3. Knowledge graph extension: nodes, edges, traversal, visualization.
4. Cross-extension integration: `--extract-entities`.

### Phase 6 — Ecosystem

1. Multi-profile config.
2. `--warn-partial`: permission-aware discovery.
3. Adapter conformance test suite.
4. Documentation, README, adapter authoring guide.
5. npm publish: `skeem`, `skeem-directus`, `@skeems/extend-memory`, `@skeems/extend-kg`.

### Phase 7 — Platform surfaces

1. skeem-fs: FUSE filesystem (Rust or Go).
2. skeem-swift-app: Apple client with App Intents.

### Deferred

- Additional adapters (Supabase, Strapi, Hasura, PostgREST).
- Filter operators beyond equality (`$gt`, `$contains`, `$in`).
- Field type changes in `define` (requires migration strategy).
- CLI cold-start optimization (single binary via `pkg` or Rust rewrite).
- Webhook/event support beyond WebSocket.

---

## 42. Appendix: Example — Agent Memory Bootstrap

End-to-end example of an agent using skeem to set up and operate its own
memory infrastructure:

```bash
#!/bin/bash
# bootstrap-agent.sh — run once per agent instance
set -euo pipefail

# 1. Initialize system tables
skeem init --yes

# 2. Install memory and KG extensions
skeem extend memory --yes
skeem extend kg --yes

# 3. Create a private memory space for this agent
skeem memory space create "assistant-1-private" --type private --actor assistant-1

# 4. Create a shared space for the team
skeem memory space create "team-shared" --type shared
skeem memory space grant "team-shared" --actor assistant-1 --permission write
skeem memory space grant "team-shared" --actor assistant-2 --permission write
skeem memory space grant "team-shared" --actor human-brent --permission admin

# 5. Seed system tags (upsert for idempotency)
skeem upsert skeem_tags --match name="system" --tag_type "concept"
skeem upsert skeem_tags --match name="user-preference" --tag_type "concept"
skeem upsert skeem_tags --match name="task-context" --tag_type "concept"

echo "Agent infrastructure ready."
```

During operation:

```bash
# Store a memory
MEM=$(skeem remember \
  --actor assistant-1 \
  --space "assistant-1-private" \
  --content "User prefers concise responses without bullet points" \
  --type procedural \
  --tag "user-preference" \
  --json)

MEM_ID=$(echo "$MEM" | jq -r '.data.id')

# Recall relevant memories before responding
skeem recall \
  --actor assistant-1 \
  --type procedural \
  --search "formatting preferences" \
  --top 5 \
  --json

# Add to knowledge graph
skeem kg add node "Brent" --type person --actor assistant-1
skeem kg add edge "Brent" --type PREFERS --target "concise responses" \
  --properties '{"context":"formatting"}' --actor assistant-1
skeem kg source @node-uuid --type memory --ref $MEM_ID

# Register an alias for fuzzy resolution
skeem alias add companies:42 "ACME Inc."
skeem alias add companies:42 "A.C.M.E Inc."

# Now this resolves via alias
skeem create people --name "Jane" --company ?name="ACME Inc." --json

# Check for schema drift in CI
skeem diff schema/agent-memory.skeem.yaml --json | jq '.changes | length'
```