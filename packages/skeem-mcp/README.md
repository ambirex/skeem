# @skeems/mcp

MCP server for [skeem](https://www.npmjs.com/package/skeem) — relational-aware
tools over headless backends (Directus, PocketBase, NocoDB, Strapi) and public
reference datasets (WikiData, MusicBrainz, OpenStreetMap, Open Library,
CrossRef, TMDB), for MCP clients like Claude.

It's the same engine the `skeem` CLI uses, exposed over stdio. Every tool
returns skeem's stable JSON envelope, so agents branch on the typed
`error.code` exactly as they do on the CLI.

## Install

```bash
# Claude Code (cwd is a project with a .skeemrc.yaml):
claude mcp add skeem -- npx -y @skeems/mcp

# Explicit backend, token via env:
claude mcp add skeem --env SKEEM_TOKEN=xxx -- npx -y @skeems/mcp \
  --adapter directus --url http://127.0.0.1:8055

# Zero-config reference dataset:
claude mcp add wikidata -- npx -y @skeems/mcp --adapter wikidata
```

Claude Desktop / Cursor use the equivalent JSON config:

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

`--adapter`, `--url`, `--token`, `--profile`, `--actor`, `--cwd`, `--read-only`.
Connection settings are fixed per server instance (one backend each); config
resolves like the CLI (args > `SKEEM_*` env > `.skeemrc.yaml` from `--cwd` >
global config > adapter default URL). Set `--cwd` explicitly — desktop clients
often launch from `/`.

## Tools

A fixed, verb-shaped set (collection is a parameter): `skeem_ls`,
`skeem_describe`, `skeem_discover`, `skeem_get`, `skeem_find`, `skeem_create`,
`skeem_update`, `skeem_upsert`, `skeem_delete`, `skeem_restore`, `skeem_link`,
`skeem_unlink`, `skeem_exec`, `skeem_claim`, `skeem_claims`, `skeem_release`,
`skeem_annotate`, `skeem_init`. Writes accept `dry_run`, `idempotency_key`,
`actor`, and `context`; relation fields accept the `?field=value` /
`??field=value` resolution grammar.

## The result contract

Tools return the envelope as JSON text and `structuredContent`. A domain
failure is a **normal result** with `ok:false` and a typed `error.code`
(NOT_FOUND, AMBIGUOUS, DUPLICATE, VALIDATION, AUTH, RELATION_NOT_FOUND,
SCHEMA_UNSUPPORTED, CACHE_STALE, USAGE, ERROR) — not an MCP `isError` — so
agents read the code instead of blind-retrying.

## Limitations

- One backend per server instance (run multiple entries for multiple backends).
- Schema mutation (`define`/`diff`) and aliases are CLI-only.
- The schema cache self-heals; a mid-session backend schema change may need a
  server restart.

Full reference: [docs/reference/mcp.md](https://github.com/ambirex/skeem/blob/main/docs/reference/mcp.md).
MIT licensed.
