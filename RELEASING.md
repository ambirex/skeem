# Releasing

`skeem` ships every package under `packages/*` to npm in **lockstep**: one
shared version, with every internal dependency pinned exactly. The invariants:

- `@skeems/types` has zero dependencies; every adapter pins `@skeems/types`
  exactly; the `skeem` CLI pins `@skeems/types` and **every** adapter exactly;
  `@skeems/mcp` pins `skeem` (the bare CLI package) exactly.
- Publish order: `@skeems/types` first, then every other `@skeems/*` adapter
  (any order among themselves), then `skeem`, then `@skeems/mcp` **last** (it
  depends on `skeem`).

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

# 1. Bump every workspace to $V in lockstep. (Direct writes, NOT `npm version -w`:
#    that re-resolves the dependency tree mid-loop while versions are skewed, falls
#    back to the registry for the still-old pins, and 404s when those versions were
#    never published.)
node -e '
  const fs = require("fs");
  for (const d of fs.readdirSync("packages")) {
    const f = `packages/${d}/package.json`;
    const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
    pkg.version = process.env.V;
    fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
  }
'

# 2. Re-pin every internal @skeems/* dependency to $V.
node -e '
  const fs = require("fs");
  for (const d of fs.readdirSync("packages")) {
    const f = `packages/${d}/package.json`;
    const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      // @skeems/* adapters, plus the bare `skeem` dep that @skeems/mcp pins.
      if (dep.startsWith("@skeems/") || dep === "skeem") pkg.dependencies[dep] = process.env.V;
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

# 6. Publish in dependency order: types -> adapters -> cli -> mcp.
#    (Each npm publish needs an OTP: pass --otp=<code>; one TOTP covers the run
#    if you go fast. After publishing, npm view/install may 404 for a few minutes
#    on scoped packuments — registry propagation, not failure; wait and retry.)
npm publish -w @skeems/types
for d in packages/*/; do
  name="$(node -p "require('./$d/package.json').name")"
  # Hold back skeem and @skeems/mcp: skeem depends on the adapters, and
  # @skeems/mcp depends on skeem, so they publish after this loop.
  case "$name" in @skeems/types|skeem|@skeems/mcp) continue ;; esac
  npm publish -w "$name"
done
npm publish -w skeem
npm publish -w @skeems/mcp
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
- `0.6.0` (2026-06-11) — `skeem tools`; adapter `link`/`unlink` capability; the
  read-tier reference family (`@skeems/wikidata` as external-ID hub, plus
  `@skeems/musicbrainz`, `@skeems/osm`, `@skeems/openlibrary`,
  `@skeems/crossref`, `@skeems/tmdb`); cross-adapter enrichment (`--enrich`
  with the `sources:` config block); schema-cache adapter validation;
  twelve-package lockstep.
- `0.7.0` (2026-06-12) — marketing push: `@skeems/mcp` MCP server (publishes
  last, after `skeem`); adapter-default URLs for the reference adapters; WikiData
  `mul`-label fix; the skeem.brenty.dev site. **Thirteen-package lockstep.**
