# @skeems/musicbrainz

Read-only [MusicBrainz](https://musicbrainz.org) adapter for [skeem](https://github.com/ambirex/skeem).

```yaml
adapter: musicbrainz
connection:
  url: https://musicbrainz.org   # or a mirror
```

No authentication. The client sends a descriptive User-Agent and enforces
MusicBrainz's ~1 request/second etiquette in-process.

## Tier: Read

Collections map to the six core entity types, keyed by MBID:
`artists`, `release_groups`, `releases`, `recordings`, `works`, `labels`.

```bash
skeem get artists 5b11f4ce-a62d-471e-81fc-a69a8278c7da --json   # Nirvana
skeem find artists --where name=Nirvana --json
skeem find release_groups --where title=Nevermind --json
```

`get` includes the entity's URL relationships:

- **`externalIds`** (shared vocabulary — see
  [docs/reference/external-ids.md](../../docs/reference/external-ids.md)):
  `wikidata`, `imdb`, `viaf`, `isni`, plus URL-valued
  `official_website`/`wikipedia`.
- **`links`** — every other relationship type as raw URLs keyed by the
  MusicBrainz relation name (`discogs`, `allmusic`, `last.fm`, …).

`find` searches by `name`/`title` (quoted Lucene phrase; `q=`/`search=` also
accepted), supports `--limit`/`--offset`, and `--where id=<mbid>` returns a
summary. There is no reverse search by external id — pivot in via the Wikidata
hub instead (`skeem find items --where label=… --adapter wikidata`, then read
`externalIds.musicbrainz_artist`).

Writes (`create`/`update`/`delete`) and schema mutation are rejected as
read-only. MusicBrainz dates are partial (`"1991"`, `"1991-09"`) and surface as
strings.
