# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Cross-adapter enrichment (`--enrich`)** on `create` and `upsert`: fold a
  record from a configured read-only source adapter into the write payload.
  `--enrich <source>:<collection>:<id>` fetches by id (ids verbatim after the
  second `:`, so colon-bearing DOIs work); `--enrich
  "<source>:<collection>?<field>=<value>"` finds exactly one match (0 →
  `NOT_FOUND`, >1 → `AMBIGUOUS`) and re-fetches it in full. Explicit
  `--field`/`--match` values always win; the target collection's introspected
  schema filters name-matched fields (never the primary key or relation
  fields); `--map sourcePath=targetField` (repeatable) maps dotted paths such
  as `externalIds.imdb`, taking `[0]` of arrays onto scalar fields. Sources
  live in a new `sources:` config block (per-name merge, `${ENV}`
  interpolation, lazily connected). The success envelope gains
  `enrichedFrom`/`enrichedFields`; the enrich spec joins provenance
  `inputRefs` and the idempotency request shape; `--dry-run` previews the
  merged payload. Source failures are attributed
  (`Enrichment source "name": …`, `error.details.enrich`). Covered by
  `enrich.test.ts` and an end-to-end section in the Directus deep smoke
  (Directus as both target and `ref:` source). Design:
  `docs/proposals/cross-adapter-enrichment.md`.

- **TMDB adapter** (`@skeems/tmdb`), read tier: `movies`, `tv`, `people` keyed
  by TMDB id. The only read-tier adapter requiring auth — one
  `connection.token` covers both schemes (v4 Read Access Token → Bearer; v3
  32-hex key → `api_key` param). `get` appends `external_ids` (`imdb`,
  `wikidata`, `tvdb`, socials); `find` searches by title/name (page-based:
  limit ≤ 20, no offset) and **reverse-resolves IMDb/Wikidata ids** via
  TMDB's `/find`. TMDB status codes map to skeem errors (34 → NOT_FOUND,
  7/10 → AUTH with a which-token hint). Live smoke self-skips without
  `TMDB_API_KEY`: `npm run smoke:tmdb`.

- **CrossRef adapter** (`@skeems/crossref`), read tier: a `works` collection
  keyed by lowercase DOI (URL/`doi:` prefixes stripped; path-encoded so legacy
  SICI DOIs with `<>;#?` work). `get` surfaces authors with bare ORCIDs and an
  `externalIds` of `orcid`/`funder_doi`/`issn`/`isbn_*`; `find` does
  bibliographic search plus a **reverse pivot by ORCID**
  (`--where orcid=…` → `filter=orcid:`) and `issn` filtering.
  `connection.mailto` joins CrossRef's polite pool. A 404 names the
  other-agency (DataCite) possibility. Live smoke: `npm run smoke:crossref`.

- **Open Library adapter** (`@skeems/openlibrary`), read tier: `works`,
  `editions`, `authors` keyed by bare OL ids (path prefixes stripped). Authors'
  `remote_ids` and editions' ISBN/OCLC/LCCN/`identifiers` surface in the shared
  `externalIds` vocabulary; `find editions --where isbn=…` resolves via
  `/isbn/{isbn}.json` (ISBNs normalized, including left-padding leading zeros
  the CLI's number coercion eats); merged records (`/type/redirect`) are
  followed one hop. Live smoke: `npm run smoke:openlibrary`.

- **OpenStreetMap adapter** (`@skeems/osm`), read tier: one `elements`
  collection keyed by type-prefixed ids (`way/5013364`) — OSM ids collide across
  node/way/relation and Nominatim cannot filter by type, so the id carries the
  type. `get` uses the OSM 0.6 API (410 Gone → NOT_FOUND); `find` searches by
  name via Nominatim (`connection.searchUrl`, self-hostable) with
  `extratags`-derived externalIds. Only the element's **bare** `wikidata` tag
  feeds `externalIds.wikidata` — `brand:wikidata`/`operator:wikidata` stay in
  `tags` (they identify the brand, not the place). ~1 req/s in-process throttle;
  ODbL attribution in the README. Live smoke: `npm run smoke:osm`.

- **MusicBrainz adapter** (`@skeems/musicbrainz`), read tier: six collections
  (`artists`, `release_groups`, `releases`, `recordings`, `works`, `labels`)
  keyed by MBID over the WS/2 API (no auth; in-process ~1 req/s throttle +
  descriptive User-Agent). `get` normalizes URL relationships into the shared
  `externalIds` vocabulary (wikidata/imdb/viaf/isni + official_website/
  wikipedia) and keeps every other relation type as raw URLs under `links`;
  `find` searches by name/title as a quoted Lucene phrase with native
  `--limit`/`--offset`. Live smoke: `npm run smoke:musicbrainz`.

- **External-ID hub on the WikiData adapter** (`docs/reference/external-ids.md`):
  `get` now returns external identifiers under `externalIds` with a shared key
  vocabulary (`imdb`, `doi`, `musicbrainz_artist`, … — curated from 29 verified
  properties; uncurated ones keep their `P####` key), plus the language's
  Wikipedia sitelink and official website. `find items` gains **reverse lookup
  by external id** (`--where imdb=nm0010930`, `--where P434=<mbid>`, any curated
  key or raw P-id) via CirrusSearch `haswbstatement`, and `--offset` support on
  label searches.

- **WikiData adapter** (`@skeems/wikidata`), a new **read tier**: read-only access
  to WikiData (or any Wikibase instance) over the public MediaWiki Action API (no
  auth). Two synthetic collections — `items` (Q-ids) and `properties` (P-ids) —
  support `ls`/`describe`/`discover`/`get`/`find`; `get` returns an entity with
  its statements flattened into simplified `claims`, and `find` searches by label.
  Writes are rejected as read-only. Verified end-to-end by a live smoke
  (`npm run smoke:wikidata`).
- **Adapter `link`/`unlink` capability** for m2m record linking on backends with
  no writable junction collection. The `SkemAdapter` contract gains optional
  `link`/`unlink` methods; the core's `link`/`unlink` verbs use them for m2m when
  present and fall back to the junction-row path otherwise (Directus is
  unchanged). **PocketBase** links via the relation-id array (accurate
  already-linked reporting); **NocoDB** links via its nested-link endpoint. This
  closes the m2m record-linking gap both backends previously had.
- **`skeem tools --format openai|anthropic`** generates LLM tool definitions from
  the live schema (spec Part VI §27): create/find/get/update/delete tools per
  collection, with parameter schemas derived from field types, required flags,
  enums, and relations (relation params document the `?`/`??` grammar). Supports
  `--collections a,b`, `--include-schema` (adds discover/define tools), and `-o`
  (writes the bare array for direct SDK use; stdout keeps the envelope).
- **`SKILL.md`** (agent playbook) and **`llms.txt`** (curated repo map) teaching
  the JSON envelope contract, discovery-first workflow, relation grammar, and
  coordination primitives.

### Changed

- **WikiData record shape**: external-id statements no longer appear inside
  `claims` (e.g. `claims.P345`); they live in `externalIds` under friendly keys.
  Unsupported `--sort` (and `--offset` where it cannot be honored) now fail with
  a validation error instead of being silently ignored.
- The schema cache is invalidated when the active adapter or connection URL
  differs from the one that wrote it — switching `--adapter`/`--url` from the
  same directory no longer serves the previous backend's schema.

### CI

- New `smoke.yml` workflow runs the end-to-end suites on pushes to `main` and on
  demand: the Directus deep smoke gates; the cross-adapter conformance suite
  (Directus, PocketBase, NocoDB) runs informationally until each fixture is
  validated. The existing `ci.yml` (build, typecheck, unit tests, pack guard)
  still runs on every push/PR.

## [0.5.0] - 2026-06-10

### Added

- **Strapi adapter** (`@skeems/strapi`), **data tier**: discovery and CRUD for
  Strapi v5 — `ls`/`describe`/`discover`/`diff`/`get`/`find`/`create`/`update`/
  `delete`/`count`. Schema mutation is intentionally unsupported (Strapi content
  types are code-defined), so `define`/`init` fail with skeem's standard
  capability errors. CRUD uses the public `/api/*` routes with a Bearer API
  token; schema introspection uses the admin content-type-builder API (admin JWT
  via `email`/`password` or `adminToken`, since API tokens cannot read it).
  Strapi v5 `documentId` is canonicalized to `id`.
- `strapi` is registered in the adapter registry and wired into the conformance
  harness (`npm run conformance:strapi`, against a user-provided instance — its
  data tier runs discovery + CRUD + diff only).

### Changed

- All packages bumped to `0.5.0` lockstep (publish order: types → directus →
  pocketbase → nocodb → strapi → cli).

## [0.4.0] - 2026-06-10

### Added

- **NocoDB adapter** (`@skeems/nocodb`): full-tier support for NocoDB v2 —
  discovery, CRUD, schema mutation (`define` + enum via SingleSelect), and system
  features. Auth via an `xc-token` API token; `connection.base` pins the base
  (auto-selected when the instance has one). The adapter keeps a name↔id catalog
  because NocoDB addresses tables/columns by id, canonicalizes the primary key to
  `id`, and skips NocoDB's system/virtual columns so a defined schema diffs clean.
  `bt` links map to m2o (fully writable); `mm`/`hm` links are introspected and
  m2m can be created via `define`, but record-level `link`/`unlink` over a native
  `mm` link is not supported (NocoDB hides the junction the link path writes to).
- `nocodb` is registered in the adapter registry and runnable via
  `npm run conformance:nocodb`.

### Changed

- All packages bumped to `0.4.0` lockstep
  (publish order: types → directus → pocketbase → nocodb → cli).
- Conformance harness now drives each adapter through a generated `.skeemrc.yaml`
  (adapter name + full connection), so adapters that authenticate with
  email/password (PocketBase) or need a base id (NocoDB) are exercised correctly.

## [0.3.0] - 2026-06-10

### Added

- **PocketBase adapter** (`@skeems/pocketbase`): full-tier support for PocketBase
  v0.23+ — discovery, CRUD, schema mutation (`define` + enum fields), system
  features (`init`, `claim`). Auth via token or `email`/`password` in
  `.skeemrc.yaml`. m2m relations are introspected read-only; m2m writes surface
  a clear capability error.
- Adapter registry in core (`packages/skeem/src/core/adapters.ts`) now lazy-loads
  `pocketbase` alongside `directus`; `config.adapter: pocketbase` is live.
- Cross-adapter conformance harness (`test/conformance/`) now includes a
  PocketBase fixture runnable via `npm run conformance:pocketbase`.

### Changed

- All packages bumped to `0.3.0` lockstep
  (publish order: types → directus → pocketbase → cli).

## [0.2.0] - 2026-06-10

### Added

- Enum / choice fields: `define` creates and updates them (Directus dropdown +
  choices), and `discover` reads the choices back into `enum`.
- `@skeems/types` package — the shared data model and `SkemAdapter` contract now
  live in one place, breaking the type cycle between the CLI and its adapters.

### Changed

- **Schema document format**: many-to-many relations now live in each
  collection's `relations` map (with optional junction detail) instead of a
  top-level `relations: ["a <-> b"]` string array. Re-run `discover` to migrate
  an existing `.skeem.yaml`. A single `define` can now create m2m on brand-new
  collections, and the two declared sides collapse into one junction.
- `SkemAdapter.updateRelation` now takes `(from, to)` instead of Directus-specific
  `current*` fields; relation changes apply as delete-then-recreate.
- `skeem` and `@skeems/directus` now pin `@skeems/types` exactly; releases are a
  three-package lockstep (publish order: types → directus → cli).

### Fixed

- A field named `status` is now writable — it previously collided with the
  `init --status` boolean flag and the value was dropped.
- `discover` no longer emits ghost collections for relations that reference a
  collection the API did not return.

## [0.1.1] - 2026-06-10

### Fixed

- Stop shipping stale compiled test artifacts in the published packages: `build`
  now cleans `dist/` before compiling, and CI fails if `npm pack` would include
  test files.

### Changed

- README: document npm availability, lead with the coordination primitives, and
  add a short "Where It Fits" comparison.
- CLI reference: document exit-code semantics (`0` success, `1` failure; the
  JSON `error.code` is the programmatic contract).

## [0.1.0] - 2026-04-29

Initial release.

### Added

- `skeem` — relational-aware CLI for headless backends, built for AI agents.
- `@skeems/directus` — Directus adapter for the skeem CLI.
- Discovery (`ls`, `describe`, `discover`), CRUD (`create`, `find`, `update`, `delete`),
  relation-aware writes (`upsert`, `link`, `unlink`), and compound `exec`.
- Schema management: `discover`, `diff`, `define`.
- System features: aliases, provenance, versions, trash, claims, annotations,
  idempotency.
- Stable JSON envelopes for agent-friendly output.
- End-to-end smoke harness against a local Directus fixture.

[Unreleased]: https://github.com/ambirex/skeem/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ambirex/skeem/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ambirex/skeem/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ambirex/skeem/releases/tag/v0.1.0
