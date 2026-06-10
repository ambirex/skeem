# Releasing

`skeem` ships every package under `packages/*` to npm in **lockstep**: one
shared version, with every internal dependency pinned exactly. The invariants:

- `@skeems/types` has zero dependencies; every adapter pins `@skeems/types`
  exactly; the `skeem` CLI pins `@skeems/types` and **every** adapter exactly.
- Publish order: `@skeems/types` first, then every other `@skeems/*` adapter
  (any order among themselves), then `skeem` last.

Adding an adapter never changes this file — the loops below derive the package
list from `packages/`.

## Prerequisites

- `npm whoami` returns the user that owns the `@skeems` org.
- The working tree is clean and on `main`.

## Releasing

Pick a new version and export it (the re-pin step reads it from the
environment):

```bash
export V=0.6.0

# 1. Bump every workspace to $V in lockstep.
for d in packages/*/; do
  npm version "$V" -w "$(node -p "require('./$d/package.json').name")" --no-git-tag-version
done

# 2. Re-pin every internal @skeems/* dependency to $V.
node -e '
  const fs = require("fs");
  for (const d of fs.readdirSync("packages")) {
    const f = `packages/${d}/package.json`;
    const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (dep.startsWith("@skeems/")) pkg.dependencies[dep] = process.env.V;
    }
    fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
  }
'

# 3. Sync the lockfile.
npm install --package-lock-only

# 4. Verify.
npm run build && npm run typecheck && npm test

# 5. Commit, tag, push.
git add packages/*/package.json package-lock.json
git commit -m "Release v$V"
git tag "v$V"
git push && git push --tags

# 6. Publish in dependency order: types -> adapters -> cli.
npm publish -w @skeems/types
for d in packages/*/; do
  name="$(node -p "require('./$d/package.json').name")"
  case "$name" in @skeems/types|skeem) continue ;; esac
  npm publish -w "$name"
done
npm publish -w skeem
```

If a later `npm publish` fails, the earlier packages are already on the
registry; the next attempt should succeed once the issue is fixed. Do not
re-publish a package at a version that already exists (npm forbids it).

## Verifying a release

```bash
mkdir /tmp/skeem-verify && cd /tmp/skeem-verify
npm init -y >/dev/null
npm install skeem
./node_modules/.bin/skeem
```

The CLI should print a JSON usage envelope.

## History

- `0.1.0` (2026-04-29) — initial release of `skeem` and `@skeems/directus`.
- `0.1.1` — clean-publish fix and docs.
- `0.2.0` — introduced `@skeems/types`; both other packages now pin it exactly.
- `0.3.0` — added `@skeems/pocketbase`; adapter registry + `AdapterError` contract.
- `0.4.0` — added `@skeems/nocodb`; five-package lockstep.
- `0.5.0` — added `@skeems/strapi` (data tier); six-package lockstep.
- `0.6.0` (unreleased) — `skeem tools`; adapter `link`/`unlink` capability; the
  read-tier reference family (`@skeems/wikidata` as external-ID hub, plus
  `@skeems/musicbrainz`, `@skeems/osm`, `@skeems/openlibrary`,
  `@skeems/crossref`, `@skeems/tmdb`); schema-cache adapter validation;
  twelve-package lockstep.
