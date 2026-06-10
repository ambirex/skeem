# Releasing

`skeem` ships as six npm packages:

- `@skeems/types` — shared types and the adapter contract (zero dependencies)
- `@skeems/directus` — the Directus adapter, pins `@skeems/types` exactly
- `@skeems/pocketbase` — the PocketBase adapter, pins `@skeems/types` exactly
- `@skeems/nocodb` — the NocoDB adapter, pins `@skeems/types` exactly
- `@skeems/strapi` — the Strapi adapter, pins `@skeems/types` exactly
- `skeem` — the CLI, pins every adapter and `@skeems/types` exactly

Because the packages pin each other exactly, they are released together at the
same version. Publish order matters: dependencies go first, so the order is
`@skeems/types` → adapters (`@skeems/directus`, `@skeems/pocketbase`,
`@skeems/nocodb`, `@skeems/strapi`) → `skeem`.

## Prerequisites

- `npm whoami` returns the user that owns (or will own) the `@skeems` org.
- The `@skeems` npm organization exists. Create it once at
  https://www.npmjs.com/org/create if it does not.
- The working tree is clean and on `main`.

## Releasing

Pick a new version (e.g. `0.5.0`).

```bash
# 1. Bump all six package.json versions in lockstep.
npm version 0.5.0 -w @skeems/types --no-git-tag-version
npm version 0.5.0 -w @skeems/directus --no-git-tag-version
npm version 0.5.0 -w @skeems/pocketbase --no-git-tag-version
npm version 0.5.0 -w @skeems/nocodb --no-git-tag-version
npm version 0.5.0 -w @skeems/strapi --no-git-tag-version
npm version 0.5.0 -w skeem --no-git-tag-version

# 2. Update the exact pins by hand:
#    packages/skeem-directus/package.json   -> dependencies["@skeems/types"] = "0.5.0"
#    packages/skeem-pocketbase/package.json -> dependencies["@skeems/types"] = "0.5.0"
#    packages/skeem-nocodb/package.json     -> dependencies["@skeems/types"] = "0.5.0"
#    packages/skeem-strapi/package.json     -> dependencies["@skeems/types"] = "0.5.0"
#    packages/skeem/package.json            -> dependencies["@skeems/types"]      = "0.5.0"
#    packages/skeem/package.json            -> dependencies["@skeems/directus"]   = "0.5.0"
#    packages/skeem/package.json            -> dependencies["@skeems/pocketbase"] = "0.5.0"
#    packages/skeem/package.json            -> dependencies["@skeems/nocodb"]     = "0.5.0"
#    packages/skeem/package.json            -> dependencies["@skeems/strapi"]     = "0.5.0"

# 3. Sync the lockfile.
npm install --package-lock-only

# 4. Verify.
npm run build && npm run typecheck && npm test

# 5. Commit, tag, push.
git add packages/*/package.json package-lock.json
git commit -m "Release v0.5.0"
git tag v0.5.0
git push && git push --tags

# 6. Publish in dependency order (types first, CLI last).
npm publish -w @skeems/types
npm publish -w @skeems/directus
npm publish -w @skeems/pocketbase
npm publish -w @skeems/nocodb
npm publish -w @skeems/strapi
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
