# Releasing

`skeem` ships as three npm packages:

- `@skeems/types` — shared types and the adapter contract (zero dependencies)
- `@skeems/directus` — the Directus adapter, pins `@skeems/types` exactly
- `skeem` — the CLI, pins both `@skeems/directus` and `@skeems/types` exactly

Because the packages pin each other exactly, they are released together at the
same version. Publish order matters: dependencies go first, so the order is
`@skeems/types` → `@skeems/directus` → `skeem`.

## Prerequisites

- `npm whoami` returns the user that owns (or will own) the `@skeems` org.
- The `@skeems` npm organization exists. Create it once at
  https://www.npmjs.com/org/create if it does not.
- The working tree is clean and on `main`.

## Releasing

Pick a new version (e.g. `0.2.0`).

```bash
# 1. Bump all three package.json versions in lockstep.
npm version 0.2.0 -w @skeems/types --no-git-tag-version
npm version 0.2.0 -w @skeems/directus --no-git-tag-version
npm version 0.2.0 -w skeem --no-git-tag-version

# 2. Update the exact pins by hand:
#    packages/skeem-directus/package.json -> dependencies["@skeems/types"] = "0.2.0"
#    packages/skeem/package.json          -> dependencies["@skeems/types"] = "0.2.0"
#    packages/skeem/package.json          -> dependencies["@skeems/directus"] = "0.2.0"

# 3. Sync the lockfile.
npm install --package-lock-only

# 4. Verify.
npm run build && npm run typecheck && npm test

# 5. Commit, tag, push.
git add packages/*/package.json package-lock.json
git commit -m "Release v0.2.0"
git tag v0.2.0
git push && git push --tags

# 6. Publish in dependency order.
npm publish -w @skeems/types
npm publish -w @skeems/directus
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
