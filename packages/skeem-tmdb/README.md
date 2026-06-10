# @skeems/tmdb

Read-only [TMDB](https://www.themoviedb.org) adapter for [skeem](https://github.com/ambirex/skeem) — movies, TV, and people, with IMDb/Wikidata bridging.

**This product uses the TMDB API but is not endorsed or certified by TMDB.**

```yaml
adapter: tmdb
connection:
  url: https://api.themoviedb.org/3
  token: ${TMDB_TOKEN}   # v4 Read Access Token (recommended) or v3 API key
  language: en-US        # optional
```

The only read-tier adapter that needs auth — get a free key at
[themoviedb.org/settings/api](https://www.themoviedb.org/settings/api). One
`connection.token` covers both schemes: a v4 Read Access Token (JWT) is sent as
a Bearer header; a 32-char v3 key goes in the `api_key` param.

## Tier: Read

Collections: **`movies`**, **`tv`**, **`people`**, keyed by the numeric TMDB id.

```bash
skeem get movies 603 --json                              # The Matrix
skeem find movies --where title="The Matrix" --json
skeem find movies --where imdb=tt0133093 --json          # reverse by IMDb id
skeem find people --where wikidata=Q42 --json            # reverse by Wikidata id
```

`get` appends `external_ids` and surfaces them in the shared vocabulary
([docs/reference/external-ids.md](../../docs/reference/external-ids.md)):
`imdb`, `wikidata`, `tvdb`, plus social handles (`facebook`/`instagram`/
`twitter`). Reverse lookups go through TMDB's `/find` endpoint and return the
bucket matching the collection you queried.

### Notes

- Search is page-based: `--limit` is capped at 20 (one page) and `--offset` is
  unsupported (validation error).
- Empty-string dates (`release_date: ""`) surface as `null`.
- TMDB status codes are mapped: 34 → NOT_FOUND; 7/10 → an auth error with a
  hint to check whether the token is a v4 RAT or a v3 key.

Writes are rejected as read-only.
