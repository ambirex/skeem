# Releasing

`skeem` ships as two npm packages:

- `@skeem/directus` — the Directus adapter
- `@skeem/cli` — the CLI, which pins `@skeem/directus` at an exact version

Because the CLI pins the adapter exactly, the two packages must be released
together at the same version. Publish order matters: the adapter goes first.

## Prerequisites

- `npm whoami` returns the user that owns (or will own) the `@skeem` org.
- The `@skeem` npm organization exists. Create it once at
  https://www.npmjs.com/org/create if it does not.
- The working tree is clean and on `main`.

## First-time release (0.1.0)

```bash
npm run build
npm run typecheck
npm test

npm publish -w @skeem/directus
npm publish -w @skeem/cli

git tag v0.1.0
git push --tags
```

## Subsequent releases

Pick a new version (e.g. `0.2.0`).

```bash
# 1. Bump both package.json versions in lockstep.
npm version 0.2.0 -w @skeem/directus --no-git-tag-version
npm version 0.2.0 -w @skeem/cli --no-git-tag-version

# 2. Update the CLI's pin to the new adapter version, by hand:
#    edit packages/skeem/package.json -> dependencies["@skeem/directus"] = "0.2.0"

# 3. Sync the lockfile.
npm install --package-lock-only

# 4. Verify.
npm run build && npm run typecheck && npm test

# 5. Commit, tag, push.
git add packages/*/package.json package-lock.json
git commit -m "Release v0.2.0"
git tag v0.2.0
git push && git push --tags

# 6. Publish in order.
npm publish -w @skeem/directus
npm publish -w @skeem/cli
```

If `npm publish -w @skeem/cli` fails, the adapter is already on the registry
and the next attempt should succeed once the CLI issue is fixed; do not
re-publish the adapter at the same version (npm forbids it).

## Verifying a release

```bash
mkdir /tmp/skeem-verify && cd /tmp/skeem-verify
npm init -y >/dev/null
npm install @skeem/cli
./node_modules/.bin/skeem
```

The CLI should print a JSON usage envelope.
