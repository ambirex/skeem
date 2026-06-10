# @skeems/types

Shared types for `skeem`.

## Responsibilities

- define the backend-agnostic data model (`Schema`, `Collection`, `Field`, `Relation`)
- define the `SkemAdapter` contract that every backend adapter implements
- define the schema-mutation input shapes (`SchemaCollectionInput`, `SchemaFieldInput`, `SchemaRelationInput`)

This package has zero runtime dependencies. Both the core `skeem` CLI and the
adapter packages depend on it, which keeps the data model in one place and
avoids an import cycle between the CLI and its adapters.

## Useful Paths

- [src/index.ts](https://github.com/ambirex/skeem/blob/main/packages/skeem-types/src/index.ts)

## Common Commands

```bash
npm run build --workspace @skeems/types
npm run typecheck --workspace @skeems/types
```
