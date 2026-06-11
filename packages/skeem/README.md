# skeem

Relational-aware CLI for headless backends (Directus, PocketBase, NocoDB,
Strapi) and public reference datasets (WikiData, MusicBrainz, OpenStreetMap,
Open Library, CrossRef, TMDB), built for AI agents. **Agents should look facts
up, not make them up.**

Try it in ten seconds — no install, no backend, no API key:

```bash
npx skeem get items Q42 --adapter wikidata --url https://www.wikidata.org --json
```

Every command returns a stable JSON envelope (`ok` / `error.code`), writes are
schema-aware with a compact relation grammar (`@id`, `?field=value`,
`??field=value`), coordination primitives (claims, idempotency, provenance,
soft delete) make multi-agent writes safe, and `--enrich` folds a reference
record into a `create`/`upsert` so your agent never types a release date from
memory:

```bash
skeem create movies --enrich tmdb:movies:603 --map externalIds.imdb=imdb_id --json
```

Full docs, the agent playbook (SKILL.md), and the design notes live in the
[GitHub repo](https://github.com/ambirex/skeem).

---

This is the core package: the CLI entrypoint and backend-agnostic runtime.

## What Lives Here

- CLI argument parsing
- output formatting
- config loading
- schema cache
- relation-aware data operations
- compound `exec`
- schema discover, diff, and define
- system-feature behaviors for aliases, provenance, versions, trash, claims, annotations, and idempotency

## Useful Paths

- [bin/skeem.ts](https://github.com/ambirex/skeem/blob/main/packages/skeem/bin/skeem.ts)
- [src/cli/index.ts](https://github.com/ambirex/skeem/blob/main/packages/skeem/src/cli/index.ts)
- [src/core/runtime.ts](https://github.com/ambirex/skeem/blob/main/packages/skeem/src/core/runtime.ts)
- [src/config/load-config.ts](https://github.com/ambirex/skeem/blob/main/packages/skeem/src/config/load-config.ts)

## Common Commands

```bash
npm run build --workspace skeem
npm run test --workspace skeem
npm run typecheck --workspace skeem
```

The root-level docs live at:

- [README.md](https://github.com/ambirex/skeem/blob/main/README.md)
- [docs/README.md](https://github.com/ambirex/skeem/blob/main/docs/README.md)
