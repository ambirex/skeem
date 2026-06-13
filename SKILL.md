---
name: skeem
description: Use when reading or writing relational data in a headless backend (Directus, PocketBase, NocoDB, Strapi) or querying public reference datasets (WikiData, MusicBrainz, OpenStreetMap, Open Library, CrossRef, TMDB) through the `skeem` CLI. Covers the JSON envelope contract, the discovery-first workflow, the relation grammar (@id / ?field=value / ??field=value), the coordination primitives (claims, idempotency, provenance, trash) that make multi-step writes safe, pivoting between reference datasets via shared external IDs, and enriching writes from a reference source (--enrich).
---

# Driving skeem as an agent

`skeem` is a relational-aware CLI for headless backends. One schema-aware command
replaces several raw API calls, and every command can return a stable JSON
envelope — so prefer it over hand-building REST/SDK requests when a backend has a
skeem adapter (Directus, PocketBase, NocoDB, Strapi).

## The one rule: always `--json`, always parse the envelope

Pass `--json` on every call and parse stdout. Never scrape human text.

```bash
skeem find companies --where name=Acme --json
```

Success envelope:

```json
{ "ok": true, "operation": "find", "collection": "companies",
  "data": [ { "id": 17, "name": "Acme" } ], "count": 1 }
```

Error envelope (process exit code is non-zero):

```json
{ "ok": false, "operation": "create", "collection": "people",
  "error": { "code": "VALIDATION", "message": "...", "field": "email" } }
```

Branch on `ok` first, then on `error.code` — never on the message text. Codes:
`NOT_FOUND`, `AMBIGUOUS`, `DUPLICATE`, `VALIDATION`, `AUTH`, `RELATION_NOT_FOUND`,
`SCHEMA_UNSUPPORTED`, `CACHE_STALE`, `USAGE`, and `ERROR` (uncategorized). Exit
code is `0` on success and `1` on any failure; `error.code` is the precise signal.

## Always discover before you write

Do not guess collection or field names. Inspect first:

```bash
skeem ls --counts --json                 # collections + row counts
skeem describe companies --json           # fields, types, relations, unique constraints
skeem discover --json                     # the whole schema as a document
```

`describe`/`discover` tell you exact field names, which fields are `required`,
which are `enum` (and their allowed values), and the relations on a collection
(`m2o`/`o2m`/`m2m`, with the related collection). Read this before constructing a
write.

## Relation grammar (the part that saves round-trips)

When a write touches a relation field, the value prefix controls resolution:

| Value             | Meaning                                                        |
| ----------------- | -------------------------------------------------------------- |
| `42`              | a literal scalar / foreign-key id                              |
| `@42`             | link to the related record with id 42                          |
| `?name=Acme`      | resolve: find the existing related record where `name=Acme`    |
| `??name=Acme`     | resolve-or-create: use it if found, otherwise create it        |
| `child.field`     | dot notation builds a nested related record inline             |

```bash
# Create a person and attach them to the existing company "Acme" in one call:
skeem create people --name "Mia" --company ?name=Acme --json

# Same, but create the company if it doesn't exist yet:
skeem create people --name "Mia" --company ??name=Acme --json
```

Prefer `?`/`??` over a manual find-then-create sequence — it is fewer steps and
avoids duplicate records.

## Core verbs

```bash
skeem get <collection> <id> [--expand relation] --json
skeem find <collection> [--where field=value]... [--limit N] [--offset N] [--sort field] --json
skeem create <collection> [--field value]... --json
skeem update <collection> <id> [--field value]... --json
skeem upsert <collection> --match field=value [--field value]... --json   # create or update by match
skeem delete <collection> <id> [--hard] --json                            # soft delete unless --hard
skeem restore <collection> <id> --json                                    # undo a soft delete
skeem link   <collection:id> <relation> <target> --json
skeem unlink <collection:id> <relation> <target> --json
```

Notes: `--where` and `--match` are equality-only (no ranges/substrings).
`--expand` resolves one level deep. `delete` moves to trash unless `--hard`.

## Safe multi-agent writes

These are why skeem exists; reach for them when work spans steps or agents:

- **Idempotency** — pass `--idempotency-key <key>` on a write; a retry with the
  same key replays the original result instead of duplicating it.
- **Claims** — `skeem claim companies:42 --lease 5m --purpose "enriching"` takes a
  lease; `skeem claims companies:42` checks it; `skeem release companies:42` frees
  it. Check claims before mutating a record another agent may hold.
- **Provenance / versions / trash** — writes are recorded; soft-deletes are
  recoverable with `restore`. Run `skeem init --json` once to provision the
  `skeem_*` system tables (Full-tier adapters only).

## Compound writes in one transaction-like call

For a dependent graph, pipe an `exec` plan on stdin. Use `$ref.field` to feed one
operation's output into the next:

```bash
echo '{"operations":[
  {"ref":"acme","op":"create","collection":"companies","data":{"name":"Acme"}},
  {"ref":"root","op":"create","collection":"people","data":{"name":"Mia","company":"$acme.id"}}
]}' | skeem exec --json
```

Each operation's verb key is `op` (`create`, `get`, `find`, `findOne`, `update`,
`delete`, `upsert`, `link`, `unlink`).

## Generate your own tool definitions

`skeem tools` emits LLM tool definitions straight from the live schema, so you can
register typed create/find/get/update/delete tools per collection:

```bash
skeem tools --format anthropic --json        # tools under data.tools
skeem tools --format openai -o tools.json    # bare array written to the file
skeem tools --format openai --include-schema # also include discover/define tools
```

Tool names are `skeem_create_<collection>`, `skeem_find_<collection>`, etc.;
relation parameters carry the `?`/`??` grammar in their description.

## Connection

Most setups use a `.skeemrc.yaml` (adapter + connection). Otherwise pass
`--url`/`--token` (and `--adapter` for non-Directus backends). Adapter-specific
auth and capabilities are in `docs/reference/configuration.md` and each adapter's
README. Capability tiers vary: Directus/PocketBase/NocoDB are full-tier; Strapi is
data-tier (no `define`/`init`); WikiData, MusicBrainz, OSM, Open Library,
CrossRef, and TMDB are read-tier (`get`/`find` only, writes rejected; only TMDB
needs a token). An adapter rejects unsupported operations with a clear error —
let the envelope tell you rather than assuming.

## Pivoting between reference datasets

The read-tier adapters share an **`externalIds`** vocabulary
(`docs/reference/external-ids.md`): every `get` returns identifiers from other
datasets, so you can hop between them with one CLI call per hop. Values are
**always arrays** — read `externalIds.wikidata[0]`, not `externalIds.wikidata`.

```bash
# Name -> the WikiData hub -> everything else:
skeem find items --where label="Douglas Adams" --adapter wikidata --json   # Q42
skeem get items Q42 --adapter wikidata --json
#   externalIds: { imdb: [...], musicbrainz_artist: [...], openlibrary: [...], ... }
skeem get authors OL272947A --adapter openlibrary --json                   # links back: wikidata Q42

# Reverse lookups (id -> record):
skeem find items --where imdb=tt0133093 --adapter wikidata --json   # any curated key or raw P-id
skeem find movies --where imdb=tt0133093 --adapter tmdb --json
skeem find works --where orcid=0000-0002-1641-3403 --adapter crossref --json
skeem find editions --where isbn=9780345391803 --adapter openlibrary --json
```

To fold a reference record into a write in one step, use `--enrich` on
`create`/`upsert` with a `sources:` block in `.skeemrc.yaml`
(`docs/reference/cli.md#enrichment---enrich`). Your explicit `--field`/`--match`
values always win; the target schema filters everything else; `--map` renames
dotted paths (arrays take `[0]` onto scalar fields):

```bash
skeem create movies --enrich tmdb:movies:603 --map externalIds.imdb=imdb_id --json
# envelope reports enrichedFrom + enrichedFields; --dry-run previews the merge
```

Etiquette: the MusicBrainz/Nominatim clients throttle to ~1 req/s **per
process** — when looping over many records you are responsible for your own
pacing (the CLI is one process per call).

## Over MCP

The same engine ships as an MCP server, `@skeems/mcp`
(`claude mcp add skeem -- npx -y @skeems/mcp`). Everything above transfers 1:1:
the tools are `skeem_<verb>` (e.g. `skeem_create`, `skeem_find`, `skeem_exec`)
with the collection as a parameter, `--json` is implicit, and the result is the
same envelope — including `ok:false` as a normal result, so branch on
`error.code` exactly as you would on the CLI. Schema mutation (`define`/`diff`)
and aliases are CLI-only. See `docs/reference/mcp.md`.

## Deeper references

- `docs/reference/cli.md` — every command and flag
- `docs/reference/mcp.md` — the MCP server: tools, launch args, client config
- `docs/reference/schema-management.md` — `discover`/`diff`/`define`
- `docs/reference/system-features.md` — claims, provenance, versions, trash, aliases
- `docs/spec/full-spec.md` — the complete design
