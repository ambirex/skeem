# CLI Reference

Examples use `skeem` as the command name. From source, run the built binary directly or link the workspace package after `npm run build`.

## Global Flags

These flags are parsed before command dispatch:

- `--adapter <name>`
- `--url <backend-url>` — optional for the read-tier reference adapters
  (`wikidata`, `musicbrainz`, `osm`, `openlibrary`, `crossref`, `tmdb`), which
  default to their canonical endpoint; required for writable backends.
- `--token <backend-token>`
- `--profile <profile-name>`
- `--json`
- `--no-cache`
- `--refresh`
- `--dry-run`
- `--yes`
- `--verbose`
- `--no-rollback`
- `--allow-destructive`
- `--actor <name>`
- `--context <json-object>`
- `--idempotency-key <key>`

Notes:

- `--context` must be a JSON object.
- Some flags only matter for certain commands. For example, `--allow-destructive` applies to schema mutations and `--no-rollback` applies to compound data writes.

## Discovery

```bash
skeem ls [--counts]
skeem describe <collection>
skeem discover [collection ...] [-o path]
skeem cache show
skeem cache clear
```

Use discovery commands to inspect the live backend before acting.

## Agent Tooling

```bash
skeem tools --format openai > tools.json
skeem tools --format anthropic > tools.json
skeem tools --format openai --collections people,companies
skeem tools --format openai --include-schema    # also emit discover/define tools
skeem tools --format openai -o tools.json        # write the bare array to a file
```

`tools` generates LLM tool definitions from the live schema (spec Part VI §27).
Each collection yields `skeem_create_*`, `skeem_find_*`, `skeem_get_*`,
`skeem_update_*`, and `skeem_delete_*` tools, with parameter schemas derived from
field types, required flags, enums, and relations. Relation parameters document
the `?`/`??` resolution grammar so a model can pass an id, `?field=value` to
resolve, or `??field=value` to resolve-or-create.

Without `-o`, the command returns the standard envelope with the tool array under
`data.tools`. With `-o <path>` it writes the bare array to the file (directly
loadable by an LLM SDK) and still returns the envelope on stdout — mirroring
`discover -o`.

## Data Reads

```bash
skeem get <collection> <id> [--expand relation]
skeem find <collection> [--where field=value] [--limit N] [--offset N] [--sort field] [--expand relation]
```

`find` currently uses equality-style filtering with repeated `--where` flags.
Filters match by equality only — there are no range or substring operators yet.
`--expand` resolves one level deep (the adapter fetches `["*", "<relation>.*"]`),
so a nested path like `a.b.c` only resolves the first hop.

## Data Writes

```bash
skeem create <collection> [--field value] [--enrich <spec>] [--map sourcePath=targetField]
skeem update <collection> <id> [--field value]
skeem upsert <collection> --match field=value [--field value] [--enrich <spec>] [--map sourcePath=targetField]
skeem delete <collection> <id> [--hard]
skeem restore <collection> <id>
skeem link <collection:id> <related_collection:id>
skeem link <collection:id> <relation> <target>
skeem unlink <collection:id> <related_collection:id>
skeem unlink <collection:id> <relation> <target>
```

Behavior highlights:

- `delete` is soft delete by default and writes to trash.
- `--hard` bypasses trash.
- `upsert` uses repeated `--match` flags for the lookup filter.
- `link` and `unlink` handle both direct relation shorthand and explicit relation syntax.

### Enrichment (`--enrich`)

`create` and `upsert` can fold a record fetched from a second, read-only
**source** adapter into the write payload. The source names an entry in the
config `sources:` block (see the
[configuration reference](configuration.md#sources-enrichment)); any registered
adapter works as a source, but the read-tier reference adapters (wikidata,
musicbrainz, osm, openlibrary, crossref, tmdb) are the intended ones.

```bash
skeem create movies --enrich tmdb:movies:603 --json
skeem upsert movies --match imdb_id=tt0133093 --enrich "tmdb:movies?title=The Matrix" --json
skeem create people --enrich wikidata:items:Q42 --map externalIds.viaf=viaf_id --json
```

Lookup grammar — one `--enrich` per call:

- `<source>:<collection>:<id>` fetches by id. After the second `:`, the id is
  taken verbatim, so ids may contain `:`, `?`, or `/` (CrossRef DOIs such as
  `crossref:works:10.7554/elife.02181` work unquoted).
- `<source>:<collection>?<field>=<value>` runs a single-equality `find` and
  requires exactly one match: zero matches fails with `NOT_FOUND`
  ("nothing to enrich from"), more than one with `AMBIGUOUS`. Values are taken
  verbatim after the first `=` (they may contain `:`) and use the same scalar
  coercion as `--where`. Whichever of `:` or `?` appears first after the source
  name decides the form. The single match is re-fetched by id, because read
  adapters return summary projections from `find` (no `externalIds`).

Merge rule, in precedence order (highest wins):

1. Explicit `--field` values and `--match` keys are never overwritten.
2. `--map <sourcePath>=<targetField>` (repeatable) copies a dotted source path
   onto a top-level target field. The target must exist in the target schema
   and must not be the primary key (`VALIDATION` otherwise). A missing or
   empty-array source path skips silently.
3. Name-match fills every remaining target-schema field from a same-named
   source value. The target collection's introspected schema is the filter, so
   junk source fields never leak in. Name-match never touches the target
   primary key or relation fields (use an explicit `--map` for those), and
   skips `null` source values and objects aimed at non-json fields.

Array-valued source paths (all `externalIds.*` values are arrays) take `[0]`
onto scalar targets and land whole on `json`/`csv` targets.

The success envelope reports what happened: `enrichedFrom: { source,
collection, id }` and `enrichedFields: [names]`. The enrich spec also joins
the provenance `inputRefs` and the idempotency request — replaying the same
`--idempotency-key` with a different `--enrich`/`--map` fails request-shape
validation. `--dry-run` previews the merged payload without writing (note: it
still performs the source read). Source-side failures are attributed in the
error message (`Enrichment source "tmdb": ...`) and in `error.details.enrich`.

Edges to know:

- On the upsert **update** path, enriched fields are included in the update
  payload, so stored values the user didn't set are overwritten from the
  source — that is the sync-from-source intent.
- `update` does not support `--enrich` (rejected with `USAGE`).
- Source error codes pass through the backend's semantics: reference adapters
  yield `NOT_FOUND` for a missing id, while Directus masks missing records as
  403, so a Directus source surfaces that case as `AUTH`.

Enrichment is sugar, not a requirement — the zero-config alternative composes
two invocations with pipes:

```bash
tmdb=$(skeem get movies 603 --adapter tmdb --url https://api.themoviedb.org/3 --token "$TMDB" --json)
skeem create movies --json \
  --title    "$(jq -r .data.title                    <<<"$tmdb")" \
  --released "$(jq -r .data.release_date             <<<"$tmdb")" \
  --imdb_id  "$(jq -r '.data.externalIds.imdb[0]'    <<<"$tmdb")"
```

## Schema Management

```bash
skeem diff <schema-file> [--direction define|discover]
skeem define <schema-file> [--dry-run] [--yes] [--allow-destructive]
```

Typical flow:

```bash
skeem discover -o schema.skeem.yaml
skeem diff schema.skeem.yaml --json
skeem define schema.skeem.yaml --dry-run --json
skeem define schema.skeem.yaml --yes --json
```

## System Features

```bash
skeem init [--status]
skeem alias add <collection:id> <alias>
skeem alias list <collection:id>
skeem alias remove <collection:id> <alias>
skeem alias search <collection> <term>
skeem claim <collection:id> --lease <duration> [--purpose text]
skeem claims <collection:id>
skeem release <collection:id>
skeem annotate <collection:id> --key <name> --value <json> [--expires <duration>]
```

These commands rely on or interact with `skeem_*` system tables.

## Exec

```bash
skeem exec < plan.json
```

Input shape:

```json
{
  "operations": [
    {
      "ref": "company",
      "op": "upsert",
      "collection": "companies",
      "match": { "name": "Acme" },
      "data": { "industry": "Robotics" }
    },
    {
      "ref": "person",
      "op": "create",
      "collection": "people",
      "data": {
        "name": "Jane",
        "company_id": "$company.id"
      }
    }
  ]
}
```

Supported `op` values:

- `create`
- `get`
- `find`
- `findOne`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`

Current caveat:

- `exec` rejects `--idempotency-key` for now.

## Output

Use `--json` for machine-readable output. Success envelopes use:

```json
{
  "v": 1,
  "ok": true,
  "operation": "find",
  "collection": "companies",
  "data": [],
  "count": 0
}
```

Error envelopes use:

```json
{
  "v": 1,
  "ok": false,
  "operation": "find",
  "collection": "companies",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

### Envelope version (`v`)

Every envelope carries `v`, the envelope **schema** version (currently `1`).
The contract is **additive-only**: new optional fields may appear without a
bump, and an `error.code` is never repurposed. `v` increments only on a
breaking change to the envelope *shape* — so a parser written against `v: 1`
keeps working as skeem grows. (Note: schema-directed value coercion, e.g. a
numeric-looking string stored in a `string` field staying a string, is a change
to *data values*, not envelope shape, and does not bump `v`.)

## Exit Codes

`skeem` currently uses two exit codes:

- `0` — the command succeeded.
- `1` — the command failed for any reason (usage, validation, auth, not found, backend errors).

Programmatic callers should branch on the JSON envelope's `error.code` (for example
`NOT_FOUND`, `VALIDATION`, `AUTH`, `DUPLICATE`, `USAGE`) rather than on the process
exit code; the exit code only signals success or failure. More granular exit codes
may be added later without changing the envelope contract.
