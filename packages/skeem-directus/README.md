# @skeem/directus

Directus adapter for `skeem`.

## Responsibilities

- connect to a Directus backend
- translate core CRUD calls into Directus API requests
- introspect Directus schema into the shared `skeem` model
- expose schema mutation primitives used by `skeem define`

Most product behavior stays in the core package. This adapter aims to stay thin and focused on backend translation.

## Useful Paths

- [src/adapter.ts](/Users/brent/dev/skeem/packages/skeem-directus/src/adapter.ts)
- [src/client.ts](/Users/brent/dev/skeem/packages/skeem-directus/src/client.ts)
- [src/index.ts](/Users/brent/dev/skeem/packages/skeem-directus/src/index.ts)

## Common Commands

```bash
npm run build --workspace @skeem/directus
npm run test --workspace @skeem/directus
npm run typecheck --workspace @skeem/directus
```
