# @skeem/cli

Core `skeem` package containing the CLI entrypoint and backend-agnostic runtime.

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
npm run build --workspace @skeem/cli
npm run test --workspace @skeem/cli
npm run typecheck --workspace @skeem/cli
```

The root-level docs live at:

- [README.md](https://github.com/ambirex/skeem/blob/main/README.md)
- [docs/README.md](https://github.com/ambirex/skeem/blob/main/docs/README.md)
