# External IDs — pivoting between reference datasets

skeem's read-tier adapters (WikiData, MusicBrainz, OpenStreetMap, OpenLibrary,
CrossRef, TMDB) expose public reference datasets that cross-link each other via
shared identifiers. Every read adapter's `get` returns an **`externalIds`**
object using one shared key vocabulary, so an agent can read an id from one
dataset and pivot into another with a different `--adapter`.

## The contract

- `externalIds` is always present on `get` results (possibly `{}`).
- Values are **always arrays of strings** — even single-valued ids. Read
  `externalIds.wikidata[0]`, not `externalIds.wikidata`.
- Arrays are deduped and never contain nulls or empty strings; keys are absent
  when there is no value.
- **Self-id rule**: a record never repeats its own primary id (a CrossRef work
  has no `doi` key; a WikiData item has no `wikidata` key).
- Only `wikipedia` and `official_website` carry URLs; every other key carries
  bare ids.

## Key vocabulary (v1)

| Key | Identifier | Notes |
| --- | --- | --- |
| `wikidata` | WikiData Q-id (`Q42`) | uppercase Q |
| `imdb` | IMDb id (`nm0010930`, `tt0133093`) | lowercase prefix |
| `isbn_10` / `isbn_13` | ISBN | hyphens/spaces stripped, `X` uppercase |
| `oclc` | OCLC control number | |
| `lccn` | Library of Congress *bibliographic* control number | WikiData P1144 |
| `lc_naf` | Library of Congress *name authority* id (`n80076765`) | WikiData P244; distinct from `lccn` |
| `doi` | DOI (`10.1038/nature12373`) | lowercase, `https://doi.org/`/`doi:` prefixes stripped |
| `orcid` | ORCID iD (`0000-0002-1825-0097`) | bare, URL prefix stripped |
| `pubmed` / `pmc` | PubMed / PubMed Central ids | |
| `issn` | ISSN | |
| `viaf` / `isni` | VIAF cluster id / ISNI | isni spaces stripped |
| `goodreads_author` / `goodreads_book` | Goodreads ids | bare numerics collide across types, hence qualified |
| `librarything` / `amazon` | LibraryThing author id / ASIN | |
| `funder_doi` | CrossRef funder registry DOI | |
| `tvdb` | TheTVDB id | |
| `musicbrainz_artist` `_release_group` `_release` `_recording` `_work` `_label` | MusicBrainz MBIDs (uuid) | type-qualified — MBIDs don't encode their type |
| `openlibrary` | Open Library key (`OL272947A`) | self-typed suffix (A/W/M) |
| `osm_node` / `osm_way` / `osm_relation` | OpenStreetMap element ids | type-qualified — numeric ids collide across types |
| `tmdb_movie` / `tmdb_tv` / `tmdb_person` | TMDB ids | type-qualified |
| `wikipedia` | Wikipedia article **URL** | language-specific |
| `official_website` | Official website **URL** | |
| `P####` | Any uncurated WikiData external-id property | raw property id |

## WikiData is the hub

`skeem get items Q42 --adapter wikidata` returns `externalIds` built from the
item's external-id statements (Q42 carries 245 of them), keyed by the vocabulary
above where curated (see `EXTERNAL_ID_PROPERTIES` in `@skeems/wikidata`) and by
raw `P####` otherwise.

**Reverse lookup** — find the item that carries a known id:

```bash
skeem find items --where imdb=nm0010930 --json     # → Q42
skeem find items --where P434=<mbid> --json        # any P-id works
```

Matching is exact and case-sensitive (imdb values are lowercased for you);
`--limit` is capped at 50.

## Pivot matrix

Which adapters **emit** each key on `get`, and which **accept** one as a lookup
(`get` id or `find` filter). Filled in as adapters land.

| Key | Emitted by | Accepted as lookup by |
| --- | --- | --- |
| `wikidata` | wikidata reverse-find target; musicbrainz, osm, openlibrary, tmdb | wikidata (`get items <Q-id>`), tmdb (`find --where wikidata=`) |
| `imdb` | wikidata, musicbrainz, openlibrary (authors), tmdb | wikidata (`find --where imdb=`), tmdb (`find --where imdb=`) |
| `doi` | wikidata | wikidata (`find --where doi=`), crossref (`get works <doi>`) |
| `orcid` | wikidata, crossref | wikidata, crossref (`find works --where orcid=`) |
| `isbn_10`/`isbn_13` | wikidata, openlibrary (editions) | openlibrary (`find editions --where isbn=`) |
| `musicbrainz_*` | wikidata, openlibrary (authors: artist) | musicbrainz (`get <collection> <mbid>`) |
| `openlibrary` | wikidata | openlibrary (`get works|editions|authors <OL-id>`) |
| `osm_*` | wikidata | osm (`get elements <type>/<id>`) |
| `tmdb_*` | wikidata | tmdb (`get movies|tv|people <id>`) |
| `viaf`, `isni`, `lc_naf` | wikidata, musicbrainz (isni), openlibrary (authors) | wikidata (`find --where viaf=` etc.) |
| `oclc`, `lccn` | wikidata, openlibrary (editions) | wikidata |
| `pubmed`, `pmc`, `issn` | wikidata, crossref (issn) | wikidata; crossref (`find works --where issn=`) |
| `goodreads_*`, `librarything`, `amazon` | wikidata, openlibrary | wikidata |
| `funder_doi` | crossref | — |
| `tvdb` | tmdb, wikidata (P4835 uncurated → P-id) | — |

## Recipes

**From a name to everything** (Douglas Adams):

```bash
skeem find items --where label="Douglas Adams" --adapter wikidata --json   # → Q42
skeem get items Q42 --adapter wikidata --json
# externalIds: { imdb: [nm0010930], musicbrainz_artist: [e9ed318d-…], openlibrary: [OL272947A], … }
skeem get artists e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4 --adapter musicbrainz --json
skeem get authors OL272947A --adapter openlibrary --json
```

**From an IMDb id back to the graph**:

```bash
skeem find items --where imdb=tt0133093 --adapter wikidata --json   # → the Matrix item
```

Each hop is one CLI call; read the id out of `externalIds.<key>[0]` and pass it
to the next adapter.

## Etiquette

The public endpoints behind these adapters are shared infrastructure. The
clients send a descriptive User-Agent and throttle where the source mandates it
(MusicBrainz and Nominatim: 1 request/second per process). That throttle is
per-process — an agent looping over many records is responsible for its own
pacing. For bulk OSM geocoding, self-host Nominatim and set `connection.searchUrl`.
