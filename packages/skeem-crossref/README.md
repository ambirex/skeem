# @skeems/crossref

Read-only [CrossRef](https://www.crossref.org) adapter for [skeem](https://github.com/ambirex/skeem) — scholarly works keyed by DOI, with ORCID and funder metadata.

```yaml
adapter: crossref
connection:
  url: https://api.crossref.org
  mailto: you@example.com   # optional but recommended: joins CrossRef's "polite pool"
```

No API key. `mailto` identifies you to CrossRef for better rate limits; it is
sent as a query param and in the User-Agent.

## Tier: Read

One collection — **`works`** — keyed by the lowercase DOI.

```bash
skeem get works 10.7554/elife.02181 --json
skeem get works "https://doi.org/10.7554/eLife.02181" --json   # prefixes stripped
skeem find works --where title="pre-mRNA splicing" --json
skeem find works --where orcid=0000-0002-1641-3403 --json      # reverse pivot by author
skeem find works --where issn=2050-084X --limit 5 --json
```

`get` returns `{ id, title, type, container_title, publisher, issued, authors,
externalIds }`. Authors carry bare ORCIDs where present; `externalIds` (shared
vocabulary — see
[docs/reference/external-ids.md](../../docs/reference/external-ids.md)) flattens
them to record level (`orcid`), plus `funder_doi` (funder registry DOIs),
`issn`, and `isbn_10`/`isbn_13` for books. The work's own DOI is the record id
and is not repeated in externalIds.

### Notes

- DOIs are normalized (URL/`doi:` prefixes stripped, lowercased) and
  path-encoded per segment, so DOIs containing `#`, `?`, `<`, `>`, `;` (e.g.
  legacy SICI DOIs) work.
- A 404 may mean the DOI is registered with another agency (DataCite, mEDRA, …)
  rather than not existing — the error message says so.
- Dates are partial (`"2014"`, `"2014-02"`) and surface as strings.
- `--sort` is unsupported; `--limit`/`--offset` are native (offset ≤ 10k).

Writes are rejected as read-only.
