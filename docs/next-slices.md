# Next Slices

This file captures the next implementation slices after the current baseline:

- npm workspace and package scaffold
- shared types, errors, config loading, cache, and output envelopes
- Directus adapter with introspection and basic CRUD
- CLI support for `ls`, `get`, `find`, `create`, `update`, `delete`, `exec`, and `cache`
- local smoke coverage for `ls`, cache, and CRUD against a temporary Directus instance

The goal for the next slices is to close the biggest Phase 1 gaps before moving on to Phase 2.

## Current Status

- Completed: Slice 1: Discovery Completeness
- Completed: Slice 2: Relation-Aware Create Path
- Completed: Slice 3: `exec` and DAG Hardening
- Next logical step: Slice 4: Config and Cache Polish

## Slice 1: Discovery Completeness

Status: completed

### Why now

`skeem ls` works end-to-end, but Phase 1 also calls for `describe` and `discover`. Those are the missing read-only discovery surfaces agents and developers will reach for first when they do not already know the schema.

### Scope

- Add `skeem describe <collection>`
- Add `skeem discover`
- Add `skeem discover <collection...>`
- Add file output support for `discover -o <path>`
- Keep `discover --json` aligned with the same underlying schema model
- Reuse live introspection for discovery commands and refresh the local schema cache as a side effect

### Deliverables

- Human-readable `describe` output for fields, primary key, unique constraints, and relations
- YAML export for `discover`
- JSON export for `discover --json`
- Shared schema serialization helpers so cache and discovery do not drift
- Smoke test coverage for:
- create a collection
- run `skeem describe widgets`
- run `skeem discover --json`
- verify the collection and fields are present

### Exit criteria

- A new user can point `skeem` at a Directus instance and answer:
- what collections exist
- what fields and relations a collection has
- what YAML declaration corresponds to the live schema

### Completion Notes

- Added `skeem describe <collection>`
- Added `skeem discover [collection ...]`
- Added `discover -o/--output`
- Added shared schema serialization helpers for cache and discovery output
- Added unit coverage for schema serialization
- Extended the Directus smoke harness to validate `describe` and `discover`

## Slice 2: Relation-Aware Create Path

Status: completed

### Why now

The project’s differentiator is not basic CRUD, it is relation-aware compound operations. The parser and runtime scaffolding are in place, but they still need live Directus validation and clearer guarantees.

### Scope

- Prove `@`, `?`, `??`, and dot notation against a real Directus fixture
- Add multi-collection test schema setup in the smoke harness
- Tighten relation resolution naming rules where necessary
- Verify best-effort rollback on compound failures
- Improve plan output for `--dry-run`

### Deliverables

- Smoke coverage for:
- nested create via dot notation
- link by explicit id using `@`
- resolve existing related record via `?`
- resolve-or-create via `??`
- rollback case where child creation succeeds and parent creation fails
- Better compound result envelopes where the plan clearly shows child operations and the root operation

### Exit criteria

- We can demonstrate a single command creating or resolving related records correctly against Directus
- Failed compound mutations do not silently strand obvious temporary records in the happy-path smoke fixture

### Completion Notes

- Added live Directus smoke coverage for:
- nested create via dot notation
- direct relation references via `@`
- resolve existing relations via `?`
- resolve-or-create relations via `??`
- rollback on parent failure after child creation
- Improved `--dry-run` compound plan output so root operations include relation placeholders
- Expanded the fixture schema to include real relational collections and relation metadata

## Slice 3: `exec` and DAG Hardening

Status: completed

### Why now

`exec` exists, but right now it is more of a skeleton than a trusted integration surface. For agent workflows this is one of the most important commands, so it should be hardened before broader Phase 2 work.

### Scope

- Expand smoke coverage for `skeem exec`
- Verify `$ref.field` substitution across create, get, and update operations
- Improve error messages for missing refs and cycles
- Add `--dry-run` parity for `exec`
- Keep batch optimization deferred unless it becomes trivial

### Deliverables

- Smoke plan coverage for:
- create a parent
- create two children with `$ref.id`
- update one child from a previous ref
- verify execution order and final state
- Unit test coverage for:
- missing ref
- cyclic ref graph
- nested ref substitution

### Exit criteria

- `skeem exec` is trustworthy enough to be the default “agent mode” command for multi-step workflows

### Completion Notes

- Added better exec error messages for:
- unknown refs referenced by an operation
- cyclic ref graphs
- unresolved nested ref segments
- Added JSON validation for `skeem exec` stdin input
- Added unit coverage for:
- missing refs
- cyclic refs
- nested ref substitution through arrays and nested objects
- Extended the Directus smoke harness to validate:
- `skeem exec --dry-run`
- topological ordering from a scrambled operation list
- `$ref.id` substitution across create, get, and update
- final persisted state after exec completes

## Slice 4: Config and Cache Polish

Status: next

### Why now

The underlying pieces exist, but they are not yet proven in realistic repo usage. Before adding more features, we should make sure normal local usage feels reliable.

### Scope

- Add integration checks for `.skeemrc.yaml`
- Verify profile selection and env interpolation
- Exercise cache refresh rules explicitly:
- cache miss
- cache hit
- `--refresh`
- `--no-cache`
- Improve `cache show` output if needed

### Deliverables

- Fixture-backed test that writes a temporary `.skeemrc.yaml` and runs CLI commands without `--url` and `--token`
- Smoke assertions that cache appears after a schema command and is reused for a data command
- Clearer cache metadata if debugging requires it

### Exit criteria

- The CLI can be used from a real project folder with config checked into the repo and without repeating connection flags on every command

## Recommended Order

1. Slice 1: Discovery Completeness
2. Slice 2: Relation-Aware Create Path
3. Slice 3: `exec` and DAG Hardening
4. Slice 4: Config and Cache Polish

## Not Next

These are intentionally not part of the next slices:

- `define` and schema mutation planning
- `diff`
- system tables and identity resolution through `skeem_aliases`
- soft delete and restore
- extension loading
- tool schema generation
- additional adapters
