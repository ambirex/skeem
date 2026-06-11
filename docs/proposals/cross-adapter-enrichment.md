# Proposal: cross-adapter enrichment (`--enrich`)

> Status: **designed, not scheduled.** Captured 2026-06-11 from a working session. This is a future slice, not current behavior.

## Context

skeem now ships read-tier "reference" adapters (Wikidata, MusicBrainz, OpenStreetMap, OpenLibrary, CrossRef, TMDB) that expose a shared `externalIds` vocabulary, so an agent can pivot across datasets by identifier. The natural next question: **can those sources enrich a record while you insert it into a writable backend** (Directus / PocketBase / NocoDB / Strapi)? e.g. `create movies --title "The Matrix"` and auto-fill `release_date`, `overview`, `imdb_id`, `wikidata_id` from TMDB.

The architectural constraint that makes this non-trivial: **a `skeem` invocation connects to exactly one adapter** (`SkeemRuntime` holds a single `adapter` built from `config.adapter`). The `?`/`??` resolve grammar and `exec` plans both resolve against that *same* backend. Cross-adapter enrichment means the runtime must open a **second (source) adapter** alongside the primary (target) one and map between them.

## What works today (no code — the baseline)

Read adapters emit stable JSON envelopes; write adapters take `--field value`. So enrichment already works by composing two invocations:

```bash
tmdb=$(skeem get movies 603 --adapter tmdb --url https://api.themoviedb.org/3 --token "$TMDB" --json)
skeem create movies --adapter directus --url "$D_URL" --token "$D_TOK" --json \
  --title    "$(jq -r .data.title                       <<<"$tmdb")" \
  --released "$(jq -r .data.release_date                 <<<"$tmdb")" \
  --imdb_id  "$(jq -r '.data.externalIds.imdb[0]'        <<<"$tmdb")" \
  --wikidata "$(jq -r '.data.externalIds.wikidata[0]'    <<<"$tmdb")"
```

This is on-ethos ("composes with pipes") and should stay documented as the zero-dependency path. The feature below removes the glue + field-mapping boilerplate.

## Proposed feature

A `--enrich` flag on `create` and `upsert` that pulls a record from a configured **source** adapter and folds it into the write payload.

```bash
skeem create movies --enrich tmdb:movies:603 --json
skeem upsert  movies --match imdb=tt0133093 --enrich "tmdb:movies?title=The Matrix" --json
skeem create people --enrich wikidata:items:Q42 --map externalIds.viaf=viaf_id --json
```

### Lookup grammar

`--enrich <source>:<collection>:<id>` (get by id) or `--enrich <source>:<collection>?<field>=<value>` (find, take the single match). `<source>` names an entry in the config `sources:` block (below), not necessarily the adapter name.

### Merge rule (the precise semantics)

1. Start from the user's explicit `--field` / `--match` values. **These always win and are never overwritten.**
2. Fetch the source record via the source adapter's `get`/`find`.
3. For each value the source record provides, set it on the target payload **only if** (a) a same-named field exists in the *target* collection's introspected schema, and (b) the user didn't already set it. The target schema is the filter, so no junk fields leak in.
4. `--map <sourcePath>=<targetField>` (repeatable) adds explicit mappings, including dotted paths into `externalIds` (`externalIds.imdb=imdb_id`). For an array-valued source path (all `externalIds.*` are arrays) mapped onto a scalar target field, take `[0]`.
5. Insert/upsert the merged payload through the normal path (so provenance, idempotency, relation resolution all still apply).

### Source connections

A new `sources:` block in `.skeemrc.yaml` — named, reusable, each a mini adapter config (most reference adapters need no auth; only TMDB needs a token):

```yaml
adapter: directus
connection: { url: http://127.0.0.1:8055, token: ${DIRECTUS_TOKEN} }

sources:
  tmdb:
    adapter: tmdb
    connection: { url: https://api.themoviedb.org/3, token: ${TMDB_TOKEN} }
  wikidata:
    adapter: wikidata
    connection: { url: https://www.wikidata.org }
```

### Output envelope

The success envelope gains `enrichedFrom: { source, collection, id }` and `enrichedFields: [names]` so the enrichment is auditable (and pairs naturally with the existing provenance record).

### Reuse (why the build is small)

- `createAdapter(name, connection)` (`packages/skeem/src/core/adapters.ts`) already instantiates+connects any adapter — the runtime just calls it a second time for the source.
- The runtime already introspects the target collection before every write (the schema filter in step 3 is free).
- No change to the `SkemAdapter` contract; source adapters are used read-only.

## Design decisions to confirm before building

1. **Source connection location** — recommend the `sources:` block above (reusable, env-interpolated) over ad-hoc `--enrich-url`/`--enrich-token` flags. (Ad-hoc flags could be a later convenience.)
2. **Field-mapping policy** — recommend "fill unset target fields by name-match, `--map` for renames, target schema as the filter." Alternative (stricter): require explicit `--map` for everything (no implicit name-match). Name-match is more ergonomic; the stricter mode avoids surprise fields. Start with name-match + `--map`.
3. **Ambiguous / empty find** — mirror `resolveLinkTarget`: error when a `?filter` lookup matches >1 ("use an id or a narrower filter"); error when it matches 0 ("nothing to enrich from"). A `?first` opt-in could relax this later.

## Scope

**v1 in:** `create` + `upsert`; single source per call; get-by-id and find-by-single-filter lookups; name-match + `--map`; `sources:` config; envelope reporting; unit tests with a mock source adapter.

**Out (later):** multiple sources merged in one call; cross-adapter `exec` plans; enrichment on `update`; transform/coerce functions in `--map`; auto-discovering the source lookup from a shared `externalIds` key already on the payload (e.g. "enrich from whatever source owns this imdb id").

## Implementation sketch

- `packages/skeem/src/core/enrich.ts` (new) — pure: parse the `--enrich` spec, apply the merge/mapping rule against a fetched source record + target schema. Unit-testable with a fake source.
- `packages/skeem/src/core/runtime.ts` — `create`/`upsert` accept an `enrich` option; a private `resolveEnrichment()` instantiates the source via `createAdapter`, fetches, and produces the merged field set before the existing write logic; add `enrichedFrom`/`enrichedFields` to the envelope.
- `packages/skeem/src/config/load-config.ts` + `types/index.ts` — parse/type the `sources` block (env interpolation already applies).
- `packages/skeem/src/cli/index.ts` — parse `--enrich` (value flag) and `--map` (repeatable) for `create`/`upsert`; thread into the runtime.
- Docs: `docs/reference/cli.md` (enrich section), `docs/reference/configuration.md` (`sources:` block), `SKILL.md` (an enrichment workflow under the pivoting section), `docs/reference/external-ids.md` (cross-link), `CHANGELOG.md`.
- Tests: `enrich.test.ts` (spec parse + merge rule with a mock source adapter); manual end-to-end demo.

## Verification

End-to-end demo: configure a `tmdb` source + a writable Directus `movies` collection, then `skeem create movies --enrich tmdb:movies:603 --map externalIds.imdb=imdb_id --json` and confirm the created record carries TMDB's title/release_date/overview + the IMDb id, with `enrichedFields` listing them. Unit tests cover the merge rule (explicit-wins, schema-filter, `--map`, array `[0]`, ambiguous/empty find) without network.
