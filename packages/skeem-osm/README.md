# @skeems/osm

Read-only [OpenStreetMap](https://www.openstreetmap.org) adapter for [skeem](https://github.com/ambirex/skeem).
Element lookups use the OSM API; name search uses [Nominatim](https://nominatim.org).

Data © OpenStreetMap contributors, available under the [ODbL](https://www.openstreetmap.org/copyright).

```yaml
adapter: osm
connection:
  url: https://api.openstreetmap.org          # element lookups
  searchUrl: https://nominatim.openstreetmap.org   # name search; point at a self-hosted Nominatim for batch use
```

No authentication. The client sends a descriptive User-Agent and enforces the
public endpoints' ~1 request/second etiquette in-process. The public Nominatim
instance is for **interactive lookups only** — for bulk geocoding, self-host
Nominatim and set `connection.searchUrl`.

## Tier: Read

One collection — **`elements`** — keyed by a type-prefixed id (`node/123`,
`way/5013364`, `relation/62422`). OSM's numeric ids collide across the three
element types, and Nominatim cannot filter by type server-side, so a single
collection with self-describing ids beats forcing the agent to guess.

```bash
skeem get elements way/5013364 --json            # the Eiffel Tower
skeem find elements --where name="Eiffel Tower" --json
```

`get` returns `{ id, type, name, lat/lon (nodes), tags, externalIds }` plus the
raw `nodes` (ways) or `members` (relations). `find` returns Nominatim summaries
with the same prefixed ids and `extratags`-derived externalIds. `--offset` and
`--sort` are unsupported (Nominatim has no stable pagination) and fail with a
validation error.

### externalIds

From the element's **own** identity tags (shared vocabulary — see
[docs/reference/external-ids.md](../../docs/reference/external-ids.md)):
`wikidata` (bare tag only, `;`-separated values split), `wikipedia`
(`lang:Title` converted to a URL), `official_website` (`website` /
`contact:website`).

Prefixed tags like `brand:wikidata` or `operator:wikidata` identify the brand
or operator, **not** this element — they stay in `tags` and never feed
`externalIds.wikidata` (otherwise every franchise location would "be" its
brand).

Deleted elements return NOT_FOUND (the API answers 410 Gone). Writes are
rejected as read-only.
