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
| `get <items\|properties> <id>` | ✅ (full entity with simplified claims) |
| `find <items\|properties> --where label=<text>` | ✅ (search) |
| `find … --where id=<id>` | ✅ (summary lookup) |
| `count` | returns `null` (the corpus is effectively unbounded) |
| `create` / `update` / `delete` | ❌ read-only |
| `define` / `init` / `link` | ❌ |

### Examples

```bash
skeem get items Q42 --json                          # Douglas Adams, with claims
skeem find items --where label="Douglas Adams" --json
skeem get properties P31 --json                     # the "instance of" property
skeem find properties --where label="instance of" --json
```

### Claims

`get` returns an entity's statements under `claims`, flattened to
`{ propertyId: [value, ...] }`. Values are simplified: entity references collapse
to their id (e.g. `"Q5"`), times to their timestamp string, quantities to their
amount, monolingual text to its string, and coordinates to `{ latitude, longitude }`.
Property ids and entity-reference values are **not** resolved to labels (that
would be an extra lookup per value) — resolve them with another `get` if needed.

This simplification is intentionally lossy: it aims for a readable payload an
agent can act on, not a faithful RDF reproduction. For full statement structure
or graph queries, use the SPARQL endpoint directly.
