# MCP Server (`@skeems/mcp`)

`@skeems/mcp` exposes skeem as a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio, so MCP clients (Claude Code, Claude Desktop, Cursor, …) can
drive the same engine the CLI uses. It is a thin pass-through to `SkeemRuntime`:
every tool returns the same JSON envelope the CLI does, so the contract you
already know — `ok`, `operation`, `data`, and the typed `error.code` — applies
unchanged.

CLI vs MCP is a deployment choice, not a behavior change. Shell-capable agents
get the lowest overhead from the `skeem` CLI directly; everything else attaches
this server.

## Install

```bash
# Claude Code, against a project's .skeemrc.yaml (cwd is the project dir):
claude mcp add skeem -- npx -y @skeems/mcp

# Explicit backend; keep the token in the environment, not argv:
claude mcp add skeem --env SKEEM_TOKEN=xxx -- npx -y @skeems/mcp \
  --adapter directus --url http://127.0.0.1:8055

# Zero-config against a reference dataset (needs no URL or key):
claude mcp add wikidata -- npx -y @skeems/mcp --adapter wikidata

# Two backends = two server entries:
claude mcp add skeem-prod -- npx -y @skeems/mcp --profile prod --cwd /path/to/project
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`)
use the same shape:

```json
{
  "mcpServers": {
    "skeem": {
      "command": "npx",
      "args": ["-y", "@skeems/mcp", "--adapter", "directus", "--url", "http://127.0.0.1:8055", "--cwd", "/path/to/project"],
      "env": { "SKEEM_TOKEN": "..." }
    }
  }
}
```

## Launch arguments

Connection settings are fixed for the lifetime of the server (one backend per
instance); per-call options arrive as tool arguments.

| Arg | Meaning |
|-----|---------|
| `--adapter <name>` | Backend adapter (directus, pocketbase, …, wikidata, …). |
| `--url <url>` | Backend URL. Optional for reference adapters (they default). |
| `--token <token>` | Auth token. Prefer `--env SKEEM_TOKEN=…` over argv. |
| `--profile <name>` | Select a profile from `.skeemrc.yaml`. |
| `--actor <name>` | Default actor recorded on writes/claims. |
| `--cwd <dir>` | Directory the runtime resolves `.skeemrc.yaml` from (walks upward). Defaults to the process cwd — set it explicitly, since desktop clients often launch from `/`. |
| `--read-only` | Register only the read tools. |

Config resolution is the CLI's: explicit args > `SKEEM_*` env > `.skeemrc.yaml`
(walking up from `--cwd`) > `~/.config/skeem/config.yaml` > adapter default URL.
Enrichment `sources:` blocks work unchanged.

## Tools

A fixed, verb-shaped set (the collection is a parameter, not a tool name), to
keep token overhead low and stable. Writes accept `dry_run`, `idempotency_key`,
`actor`, and `context` where the CLI does.

| Tool | Purpose |
|------|---------|
| `skeem_ls` | List collections (optional row `counts`). |
| `skeem_describe` | Field types, required/unique, relations for one collection. |
| `skeem_discover` | Export the schema document (optionally scoped). |
| `skeem_get` | Get one record by id (optional `expand`). |
| `skeem_find` | Find by `where` equality (`limit`/`offset`/`sort`/`expand`). |
| `skeem_create` | Create a record; supports `enrich` + `map`. |
| `skeem_update` | Update fields by id. |
| `skeem_upsert` | Update the `match` record or create it; supports `enrich` + `map`. |
| `skeem_delete` | Soft-delete to trash (`hard: true` to delete permanently). |
| `skeem_restore` | Restore a soft-deleted record. |
| `skeem_link` / `skeem_unlink` | Link/unlink across a relation. |
| `skeem_exec` | Run a multi-step plan with `$ref.field` resolution (no idempotency key). |
| `skeem_claim` / `skeem_claims` / `skeem_release` | Lease coordination on a record. |
| `skeem_annotate` | Attach a key/value (any JSON) annotation, optional expiry. |
| `skeem_init` | Provision the `skeem_*` system collections (idempotent). |

Field values are scalars (string/number/boolean/null); they round-trip through
the same coercion as the CLI, and relation fields accept the `?field=value` /
`??field=value` grammar. Tools are annotated with `readOnlyHint` /
`destructiveHint` / `idempotentHint`.

### Not exposed (use the CLI)

- **Schema mutation** (`define`, `diff`) — destructive surface, and `define`'s
  confirmation reads stdin (the transport). Schema work stays in the CLI.
- **Aliases** — niche; reachable via the CLI.
- **`cache`** — the schema cache self-heals (TTL + `CACHE_STALE`); a mid-session
  backend schema change may need a server restart.

## The result contract (`ok:false` is a normal result)

Tool handlers return the envelope as JSON text content **and**
`structuredContent`. A domain failure comes back as a normal result with
`ok:false` and a typed `error.code` (NOT_FOUND, AMBIGUOUS, DUPLICATE,
VALIDATION, AUTH, RELATION_NOT_FOUND, SCHEMA_UNSUPPORTED, CACHE_STALE, USAGE,
ERROR) — **not** as an MCP protocol error (`isError`). This is deliberate: the
typed code is skeem's agent contract, and flattening it to a generic failure
would make models blind-retry instead of reading the code. Only malformed tool
arguments surface as protocol-level errors.

## Lifecycle

The runtime is created lazily on the first tool call, so a server launched
before its backend is reachable (or before `.skeemrc.yaml` exists) does not
crash — the config error surfaces as a readable `ok:false` envelope, and the
next call retries after you fix it. All diagnostics go to stderr; stdout is the
protocol stream.

## Verify

```bash
npm run smoke:mcp   # boots the Directus fixture and drives the built server over stdio
# or interactively:
npx @modelcontextprotocol/inspector node packages/skeem-mcp/dist/bin/skeem-mcp.js --adapter wikidata
```
