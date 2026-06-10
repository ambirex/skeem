# @skeems/openlibrary

Read-only [Open Library](https://openlibrary.org) adapter for [skeem](https://github.com/ambirex/skeem).

```yaml
adapter: openlibrary
connection:
  url: https://openlibrary.org
```

No authentication; a descriptive User-Agent is sent.

## Tier: Read

Collections: **`works`**, **`editions`**, **`authors`**, keyed by bare Open
Library ids (`OL2163649W` / `OL27297031M` / `OL272947A`). Path-prefixed keys
(`/works/OL…`) are accepted on input and stripped everywhere on output.

```bash
skeem get authors OL272947A --json                     # Douglas Adams
skeem get works OL2163649W --json
skeem find works --where title="Hitchhiker's Guide" --json
skeem find authors --where name="Douglas Adams" --json
skeem find editions --where isbn=9780261103569 --json  # ISBN lookup
```

### externalIds

Shared vocabulary — see
[docs/reference/external-ids.md](../../docs/reference/external-ids.md):

- **authors** expose `remote_ids`: `wikidata`, `viaf`, `isni`, `imdb`,
  `musicbrainz_artist`, `goodreads_author`, `lc_naf`, `librarything`, `amazon`
  (unknown keys pass through as-is).
- **editions** expose `isbn_10`/`isbn_13` (normalized), `oclc`, `lccn`, and
  `identifiers` (`goodreads_book`, …).

### Notes

- Edition records are fetched via `/books/{id}.json` (Open Library's path for
  editions); ISBN lookups go through `/isbn/{isbn}.json` and follow the
  redirect. A missing ISBN returns an empty find result, not an error.
- Merged records (HTTP 200 with a `/type/redirect` body) are followed one hop.
- ISBNs are normalized: hyphens/spaces stripped, `X` uppercased, and all-digit
  values shorter than 10 left-padded (the CLI's number coercion eats leading
  zeros — `--where isbn=0261103563` still works).
- `--sort` is unsupported (validation error); works/authors search supports
  `--limit`/`--offset`.

Writes are rejected as read-only.
