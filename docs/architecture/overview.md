# Architecture Overview

The implementation is split into a backend-agnostic core package and a Directus adapter package.

## Packages

- [packages/skeem](/Users/brent/dev/skeem/packages/skeem) contains the CLI, core runtime, cache, schema tooling, output formatting, and system-feature logic.
- [packages/skeem-directus](/Users/brent/dev/skeem/packages/skeem-directus) contains the Directus adapter and schema introspection logic.

## Core Responsibilities

The core runtime in [runtime.ts](/Users/brent/dev/skeem/packages/skeem/src/core/runtime.ts) is responsible for:

- config loading and adapter startup
- schema cache orchestration
- discovery and output envelopes
- relation-aware write parsing
- compound execution and rollback coordination
- schema diff and define planning
- system-feature behaviors like provenance, versions, trash, claims, annotations, and idempotency

The CLI parser in [index.ts](/Users/brent/dev/skeem/packages/skeem/src/cli/index.ts) stays intentionally small and dispatches into runtime methods.

## Adapter Boundary

The adapter interface is defined in [types/index.ts](/Users/brent/dev/skeem/packages/skeem/src/types/index.ts). The goal is to keep most product logic out of adapter packages.

The Directus adapter in [adapter.ts](/Users/brent/dev/skeem/packages/skeem-directus/src/adapter.ts) currently handles:

- connection bootstrap
- CRUD primitives
- counting
- schema introspection
- schema mutation primitives used by `define`

## Configuration And Cache

Config loading lives in [load-config.ts](/Users/brent/dev/skeem/packages/skeem/src/config/load-config.ts).

The cache layer stores introspected schema plus metadata and is keyed by the backend host. Runtime flags like `--refresh` and `--no-cache` control how aggressively the cache is bypassed.

## Testing Strategy

The repo uses two main testing layers:

- unit tests with Vitest for parser, schema, system-feature, and helper logic
- a live Directus smoke harness in [test/smoke/directus-ls.mjs](/Users/brent/dev/skeem/test/smoke/directus-ls.mjs)

The smoke harness exercises a broad end-to-end path:

- discovery
- CRUD
- relation-aware writes
- schema diff and define
- aliases
- provenance
- versions
- trash and restore
- claims
- annotations
- idempotency

## Current Shape Vs Original Spec

The original design document remains in [docs/spec/full-spec.md](/Users/brent/dev/skeem/docs/spec/full-spec.md). The implemented repo now covers much more than the original bootstrap phase, so code and smoke tests are often the best guide to what is live today.
