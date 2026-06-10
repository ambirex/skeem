# @skeems/wikidata

Read-only [WikiData](https://www.wikidata.org) (and any [Wikibase](https://wikiba.se) instance) adapter for [skeem](https://github.com/ambirex/skeem).

## Usage

```sh
npm install -g skeem @skeems/wikidata
```

```yaml
adapter: wikidata
connection:
  url: https://www.wikidata.org   # or any Wikibase instance
  language: en                    # label/description language (default: en)
```

No authentication is required. The adapter talks to the MediaWiki Action API
(`/w/api.php`) and sends a descriptive User-Agent per Wikimedia etiquette.

## Tier: Read

WikiData is a knowledge graph, not a table store, so it maps to two synthetic,
read-only collections:

- **`items`** — Q-id entities (people, places, works, concepts, …)
- **`properties`** — P-id properties (the predicates used in statements)

Each is keyed by `id`, with stable `label`, `description`, and `aliases` fields.

| Capability | Supported |
| --- | --- |
| `ls`, `describe`, `discover` | ✅ |
| `get <items\|properties> <id>` | ✅ (full entity: simplified claims + externalIds) |
| `find <items\|properties> --where label=<text>` | ✅ (search; `--offset` supported) |
| `find … --where id=<id>` | ✅ (summary lookup) |
| `find items --where imdb=… / doi=… / P####=…` | ✅ (reverse lookup by external id) |
| `count` | returns `null` (the corpus is effectively unbounded) |
| `create` / `update` / `delete` | ❌ read-only |
| `define` / `init` / `link` | ❌ |

### Examples

```bash
skeem get items Q42 --json                          # Douglas Adams: claims + externalIds
skeem find items --where label="Douglas Adams" --json
skeem find items --where imdb=nm0010930 --json      # reverse: external id -> Q42
skeem get properties P31 --json                     # the "instance of" property
skeem find properties --where label="instance of" --json
```

### Claims and external identifiers

`get` splits an entity's statements into two objects:

- **`externalIds`** — statements whose property has the `external-id` datatype
  (Q42 carries 245 of them), keyed by the shared vocabulary in
  [docs/reference/external-ids.md](../../docs/reference/external-ids.md) where
  curated (`imdb`, `doi`, `musicbrainz_artist`, …) and by the raw `P####`
  otherwise. P856 (official website) and the language's Wikipedia sitelink are
  folded in as `official_website` / `wikipedia`. Values are always arrays of
  strings.
- **`claims`** — everything else, flattened to `{ propertyId: [value, ...] }`.
  Entity references collapse to their id (e.g. `"Q5"`), times to their timestamp
  string, quantities to their amount, monolingual text to its string, and
  coordinates to `{ latitude, longitude }`. Property ids and entity references
  are **not** resolved to labels — resolve them with another `get` if needed.

> **Changed in 0.6.0**: external-id statements used to appear inside `claims`
> (e.g. `claims.P345`); they now live in `externalIds` under friendly keys.

### Reverse lookup

`find items --where <key>=<value>` accepts one external-id filter — a curated
key (`imdb`, `doi`, `viaf`, …) or any raw `P####` — and resolves it via
CirrusSearch `haswbstatement`. Matching is exact and case-sensitive (imdb values
are lowercased for you); `--limit` is capped at 50; items only.

This simplification is intentionally lossy: it aims for a readable payload an
agent can act on, not a faithful RDF reproduction. For full statement structure
or graph queries, use the SPARQL endpoint directly.
