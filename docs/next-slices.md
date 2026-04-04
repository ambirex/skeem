# Next Slices

This file captures the next implementation slices after the current baseline:

- npm workspace and package scaffold
- shared types, errors, config loading, cache, and output envelopes
- Directus adapter with introspection and basic CRUD
- CLI support for `ls`, `get`, `find`, `create`, `update`, `delete`, `exec`, and `cache`
- local smoke coverage for `ls`, cache, and CRUD against a temporary Directus instance

The goal of the original next slices was to close the biggest Phase 1 gaps before moving on to Phase 2. Those Phase 1 gaps are now covered, so the next logical work starts building safe schema-management foundations.

## Current Status

- Completed: Slice 1: Discovery Completeness
- Completed: Slice 2: Relation-Aware Create Path
- Completed: Slice 3: `exec` and DAG Hardening
- Completed: Slice 4: Config and Cache Polish
- Completed: Slice 5: Schema Diff Foundation
- Completed: Slice 6: `define` Planning and Guardrails
- Completed: Slice 7: Schema Mutation Expansion
- Completed: Slice 8: Higher-Level Data Verbs
- Completed: Slice 9: Exec Verb Parity
- Completed: Slice 10: Identity and Alias Resolution
- Completed: Slice 11: System Initialization and Provisioning
- Completed: Slice 12: Provenance Tracking Foundation
- Completed: Slice 13: Version History Foundation
- Completed: Slice 14: Soft Delete and Restore Foundation
- Next logical step: Slice 15: Claims and Coordination Foundation

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

Status: completed

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

### Completion Notes

- Added richer cache metadata to `cache show`, including cache directory, schema path, meta path, and TTL
- Extended the Directus smoke harness to create a temporary config workspace with `.skeemrc.yaml`
- Added smoke coverage for:
- config discovery from nested working directories
- default profile selection
- env-selected profile overrides
- env interpolation for connection values
- alias resolution through configured schema aliases
- cache miss populating cache files
- cache hit reusing cache without rewriting metadata
- `--refresh` forcing cache rewrite
- `--no-cache` skipping cache writes entirely

## Slice 5: Schema Diff Foundation

Status: completed

### Why now

The runtime path is now strong enough that the biggest remaining product gap is schema management. The safest next move is to add read-only declaration parsing and diff planning before we let the CLI mutate live schema.

### Scope

- Add a declaration loader for discovered or hand-written skeem YAML
- Normalize declaration models so live introspection and desired schema use the same comparison shape
- Add `skeem diff` as a read-only command
- Focus on collection, field, relation, and uniqueness changes first
- Keep live schema mutation out of scope for this slice

### Deliverables

- `skeem diff --json` that compares a declaration file against live Directus schema
- Human-readable diff output that highlights creates, updates, and removals
- Unit coverage for declaration parsing and schema comparison rules
- Smoke coverage that:
- discovers schema to a file
- modifies the declaration
- runs `skeem diff`
- verifies the planned changes match expectations

### Exit criteria

- A user can point `skeem` at a schema file and preview what would change before any destructive or mutating schema command exists

### Completion Notes

- Added schema document parsing and normalization for discovered or hand-written `.skeem.yaml`
- Added `skeem diff <schema-file>` with `--direction define|discover`
- Added JSON diff output with directional resolutions, summaries, and collection matches
- Added human-readable diff output for collection, field, relation, and uniqueness drift
- Extended discovery documents to include composite unique constraints
- Added unit coverage for:
- schema document parsing
- directional diff resolution
- no-drift collection matches
- Extended the Directus smoke harness to:
- discover live schema
- modify a schema document on disk
- verify `skeem diff` in both `define` and `discover` directions

## Slice 6: `define` Planning and Guardrails

Status: completed

### Why now

We can now detect drift safely. The next step is to turn those diffs into an explicit schema plan and a guarded `define` workflow so users can review what would change before anything mutates live infrastructure.

### Scope

- Add `skeem define <schema-file> --dry-run` backed by the diff engine
- Translate diff output into ordered schema actions
- Support additive collection, field, relation, and uniqueness changes first
- Require explicit confirmation for destructive actions and defer them when support is incomplete
- Keep adapter write primitives narrow and Directus-only

### Deliverables

- `skeem define --dry-run --json` returning an ordered schema plan
- Human-readable plan output with safe/additive vs destructive actions called out clearly
- Confirmation and `--yes` handling for non-dry-run execution
- Unit coverage for plan ordering and destructive-action gating
- Smoke coverage that:
- applies an additive schema file change
- re-runs `skeem diff`
- verifies drift is resolved

### Exit criteria

- A user can move from drift detection to a reviewed schema plan, then apply safe additive changes with predictable behavior

### Completion Notes

- Added `skeem define <schema-file>` with `--dry-run`, `--yes`, and `--allow-destructive` flag handling
- Added a schema plan builder that turns `diff` output into ordered schema actions
- Added human-readable define plan output and structured JSON plan summaries
- Implemented Directus schema writes for:
- collection creation
- field creation
- safe additive field updates
- m2o relation creation
- Added guardrails that keep destructive and unsupported actions in the plan but mark them skipped instead of executing them
- Added unit coverage for:
- additive plan ordering
- destructive and unsupported action gating
- Extended the Directus smoke harness to:
- validate `define --dry-run`
- apply an additive schema file with `define --yes`
- re-run `diff` and verify schema drift is resolved

## Slice 7: Schema Mutation Expansion

Status: completed

### Why now

The guarded additive path is working, but the remaining schema-management gaps are now concentrated in unsupported mutations: many-to-many junction creation, composite unique constraints, relation updates, and destructive schema changes.

### Scope

- Add execution support for many-to-many relation creation
- Add execution support for composite unique constraints where Directus allows it
- Expand field update support beyond the current safe subset
- Implement destructive execution paths behind `--allow-destructive`
- Keep the planner as the source of truth for what is executable vs blocked

### Deliverables

- `define` execution for m2m junctions and composite uniqueness where supported
- Destructive plan entries that can execute only with `--allow-destructive`
- Better adapter coverage for relation and field mutation edge cases
- Unit coverage for:
- destructive gating and execution eligibility
- m2m planning and execution ordering
- Smoke coverage that:
- adds an m2m relation or equivalent junction
- applies an allowed destructive change with `--allow-destructive`
- verifies post-apply drift is zero

### Exit criteria

- `skeem define` can handle the major remaining Phase 2 schema mutations instead of stopping at additive collection/field/m2o changes

### Completion Notes

- Expanded Directus schema introspection so junction collections stay hidden from normal collection output while many-to-many relations are reconstructed from live relation metadata
- Added `define` execution for many-to-many relation creation and removal, including alias fields, junction collections, and relation rows
- Added destructive schema execution for:
- relation removal
- many-to-many relation removal
- field removal
- collection removal
- Expanded field mutation support to cover a broader safe update subset, including clearing defaults when the declared schema removes one
- Added relation update execution by replacing the previous live shape with the declared one through the schema planner
- Kept composite unique constraints visible in diff and planning output but blocked from execution because Directus REST schema APIs do not expose them directly
- Added unit coverage for:
- additive many-to-many planning
- destructive planning classification
- Extended the Directus smoke harness to:
- apply a schema that creates a many-to-many relation
- verify discovered schema and `ls` output after apply
- prove destructive actions are skipped without `--allow-destructive`
- apply destructive actions with `--allow-destructive`
- re-run `diff` and verify drift is zero

## Slice 8: Higher-Level Data Verbs

Status: completed

### Why now

The core data path and schema path are now both credible. The next value step is to reduce the multi-command friction around common relational workflows so agents and humans can express intent at a higher level.

### Scope

- Add `skeem upsert`
- Add `skeem link`
- Add `skeem unlink`
- Reuse the existing relation resolution and execution primitives instead of creating a parallel mutation path
- Keep soft delete and trash semantics out of scope

### Deliverables

- `upsert` with explicit match criteria and predictable JSON envelopes
- `link` and `unlink` for supported Directus relation shapes, starting with `m2o` and `m2m`
- Clear errors when relation metadata is missing or the requested link shape is ambiguous
- Unit coverage for:
- match resolution and no-match vs multi-match behavior
- relation mutation planning for `link` and `unlink`
- Smoke coverage that:
- upserts an existing record
- upserts a missing record
- links two existing records
- unlinks them and verifies final state

### Exit criteria

- Common “find or create, then connect” workflows no longer require dropping down to handwritten `exec` plans for routine cases

### Completion Notes

- Added `skeem upsert <collection> --match field=value ...` with explicit create vs update behavior and stable JSON envelopes
- Reused the existing data runtime rather than building a second mutation stack, so `upsert` can share nested relation handling and rollback behavior with `create` and `update`
- Added `skeem link` and `skeem unlink` for supported relation shapes:
- m2o updates on the source record
- m2m junction row creation and removal
- Supported both compact `source target_collection:id` syntax and explicit `source relation target` syntax
- Added idempotent outcomes for repeated relation mutations:
- `already_linked`
- `already_unlinked`
- Added unit coverage for:
- upsert no-match vs single-match vs ambiguous-match behavior
- match/create payload merging and conflict detection
- relation parsing and mutation planning for `link` and `unlink`
- Extended the Directus smoke harness to validate:
- upsert create
- upsert update
- m2m link and unlink, including dry-run and duplicate-link no-op behavior
- m2o link and unlink, including dry-run and repeat no-op behavior

## Slice 9: Exec Verb Parity

Status: completed

### Why now

The CLI now has higher-level verbs, but agent workflows still need to drop back to lower-level operations inside `skeem exec`. The next logical step is to let exec plans express the same intent directly.

### Scope

- Extend `skeem exec` to support `upsert`
- Extend `skeem exec` to support `link`
- Extend `skeem exec` to support `unlink`
- Define an explicit exec payload shape for relation verbs instead of overloading positional CLI grammar
- Keep bulk optimization limited to creates unless broader batching falls out naturally

### Deliverables

- Exec plan support for mixed `create`, `update`, `upsert`, `link`, and `unlink` DAGs
- Ref resolution for `match`, ids, and relation targets where applicable
- Clear validation errors for malformed relation operations inside exec plans
- Unit coverage for:
- exec verb payload validation
- ref substitution through higher-level verbs
- Smoke coverage that:
- upserts a record in an exec plan
- links and unlinks records in the same plan
- verifies final persisted state after the DAG completes

### Exit criteria

- Agent-generated exec plans can use the same higher-level verbs as the top-level CLI without dropping down to manual junction or match logic

### Completion Notes

- Extended `ExecOperationInput` to support:
- `upsert` with `match`
- `link` and `unlink` with explicit `relation` and structured `target` payloads
- Kept exec relation targets explicit objects so agent-generated plans do not need to emulate CLI positional parsing
- Added exec runtime support for:
- upsert create/update behavior
- relation linking and unlinking across `m2o` and `m2m`
- idempotent no-op outcomes for repeated relation mutations
- Added dry-run validation for higher-level exec verbs without requiring live mutation side effects
- Added unit coverage for:
- refs inside `match` payloads
- refs inside structured relation `target` payloads
- malformed exec relation target validation
- Extended the Directus smoke harness to validate:
- exec dry-run ordering with `upsert`, `link`, and `unlink`
- exec upsert create and update
- exec link and unlink using ref-resolved source ids and target ids
- final persisted state after the DAG completes

## Slice 10: Identity and Alias Resolution

Status: completed

### Why now

The higher-level relation verbs are now in place, but they still only resolve against concrete fields. The next logical product step is to add the identity layer the spec references repeatedly so `?`, `??`, `upsert`, and relation linking can resolve stable aliases as well as raw field matches.

### Scope

- Introduce the minimal `skeem_aliases` system-table foundation needed for runtime resolution
- Extend resolve paths used by `?`, `??`, `upsert`, `link`, and `unlink` to fall back to aliases where appropriate
- Keep broader system-table rollout out of scope
- Keep alias writes/manual management lightweight at first

### Deliverables

- A stable alias lookup path in the runtime for higher-level resolution verbs
- Clear precedence rules between direct field matches and alias matches
- Unit coverage for:
- direct hit vs alias hit behavior
- ambiguous alias results
- Smoke coverage that:
- resolves a relation by alias
- upserts or links through an alias-backed lookup
- verifies expected records are targeted without duplicate creation

### Exit criteria

- The resolution-oriented verbs behave the way the spec describes when a record is identified by a stable alias instead of a primary field value

### Completion Notes

- Added a shared alias normalization and lookup path for runtime resolution verbs
- Alias fallback now checks direct field matches first, then normalized aliases in `skeem_aliases`
- Integrated alias-aware resolution into:
- `?`
- `??`
- `upsert`
- `link`
- `unlink`
- Added lightweight alias management commands:
- `skeem alias add`
- `skeem alias list`
- `skeem alias remove`
- `skeem alias search`
- Added minimal `skeem_aliases` provisioning on first alias write, while alias-backed reads safely no-op when the alias store has not been created yet
- Added unit coverage for:
- alias normalization
- alias lookup candidate detection
- Added Directus smoke coverage for:
- alias add/list/search/remove
- alias-backed relation resolution
- alias-backed upsert
- alias-backed link

## Slice 11: System Initialization and Provisioning

Status: completed

### Why now

We now have the first real system-table behavior, but it is still provisioned implicitly. The next logical step is to make that infrastructure explicit and inspectable so a repo or agent can prepare a backend intentionally before relying on higher-level features.

### Scope

- Add `skeem init`
- Add `skeem init --status`
- Provision the currently supported system table set explicitly, starting with `skeem_aliases`
- Keep destructive reset behavior and broader system-table rollout narrow unless it is trivial

### Deliverables

- A repeatable initialization command for supported system tables
- Status output that shows which supported system tables already exist
- Clear separation between explicitly provisioned tables and future placeholders
- Unit or integration coverage for:
- idempotent re-run behavior
- status output before and after initialization
- Smoke coverage that:
- runs `skeem init`
- verifies `skeem_aliases` exists
- re-runs `skeem init` safely without drift or duplicate creation

### Exit criteria

- A user can intentionally prepare a backend for the currently supported system-table features without depending on side effects from alias writes

### Completion Notes

- Added `skeem init`
- Added `skeem init --status`
- Centralized the currently supported system-table definitions in one module so runtime features and provisioning share the same source of truth
- Explicit provisioning now supports the current system-table surface:
- `skeem_aliases`
- Kept initialization idempotent:
- first run creates missing supported tables
- repeat runs report a no-op state instead of attempting duplicate creation
- Preserved lightweight alias auto-provisioning, but now route it through the same system-table definitions used by `skeem init`
- Added unit coverage for:
- supported system-table definitions
- status generation from live schema presence
- Extended the Directus smoke harness to validate:
- `init --status` before provisioning
- `init` provisioning
- `init --status` after provisioning
- idempotent re-run behavior

## Slice 12: Provenance Tracking Foundation

Status: completed

### Why now

We now have explicit system-table provisioning and the first identity table in place. The next logical step is to make writes observable, since provenance is the next system-table-backed behavior the spec calls out and it compounds the value of every existing mutation verb.

### Scope

- Introduce the minimal `skeem_provenance` table definition and provisioning support
- Record provenance entries for core write operations:
- create
- update
- delete
- link
- unlink
- upsert
- Thread `--actor` and `--context` through provenance writes where available
- Keep full diff snapshots and version history out of scope

### Deliverables

- `skeem init` support for provisioning `skeem_provenance`
- Automatic provenance writes for supported mutation verbs
- Clear provenance record shape that identifies collection, record id, operation, actor, and context
- Unit or integration coverage for:
- provenance payload creation
- actor/context propagation
- Smoke coverage that:
- performs one or more write operations
- queries `skeem_provenance`
- verifies the expected entries were recorded

### Exit criteria

- Core write activity is queryable in the backend without requiring external logging or manual audit hooks

### Completion Notes

- Added `skeem_provenance` to the supported system-table set and `skeem init` provisioning flow
- Added shared provenance payload helpers with actor precedence:
- `--actor`
- config actor
- default fallback
- Threaded provenance writes through the shared runtime for:
- `create`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`
- `exec` variants of those write operations
- Recorded actor, actor type, context, idempotency key, and input metadata in provenance rows
- Added unit coverage for:
- provenance actor resolution
- provenance payload shaping
- Extended the Directus smoke harness to validate:
- `init` status and provisioning for `skeem_provenance`
- create provenance rows with actor/context/idempotency
- upsert provenance rows
- link and unlink provenance rows
- delete provenance rows

## Slice 13: Version History Foundation

Status: completed

### Why now

Provenance is now in place, which gives us the stable foreign-key and audit context the spec expects for version history. The next logical step is to capture previous record state before updates so change history becomes queryable without introducing full restore flows yet.

### Scope

- Introduce the minimal `skeem_versions` system-table definition and provisioning support
- Snapshot the previous record state before `update` and update-shaped `upsert` operations
- Store version number, prior snapshot, changed fields, and provenance linkage where available
- Keep restore, diff-between-versions, and soft delete out of scope for this slice

### Deliverables

- `skeem init` support for provisioning `skeem_versions`
- Automatic version rows written before successful updates
- Stable version numbering per `(collection, record_id)`
- Unit or integration coverage for:
- version number incrementing
- changed-field detection
- provenance linkage
- Smoke coverage that:
- updates a record at least twice
- queries `skeem_versions`
- verifies snapshots and version numbers are correct

### Exit criteria

- A user can inspect prior record state for normal updates without relying on external backup or audit systems

### Completion Notes

- Added `skeem_versions` to the supported system-table set and `skeem init` provisioning flow
- Added shared version helpers for:
- changed-field detection
- version record shaping
- Hooked version recording into the shared update paths for:
- `update`
- update-shaped `upsert`
- `exec` update
- update-shaped `exec upsert`
- Version rows now store:
- per-record version number
- the pre-update snapshot
- changed field names
- linked provenance row ids where available
- Added unit coverage for:
- changed-field detection across primitive and nested values
- version record shaping with provenance linkage
- Extended the Directus smoke harness to validate:
- `init` status and provisioning for `skeem_versions`
- a direct `update` creating version `1`
- an update-shaped `upsert` creating version `2`
- snapshot ordering and changed-field contents via `skeem find skeem_versions --sort -version`

## Slice 14: Soft Delete and Restore Foundation

Status: completed

### Why now

Version history is in place, so the next logical step is to stop losing deleted records outright. The spec’s next major behavior is soft delete through `skeem_trash`, and that builds naturally on the provenance and snapshot work we now have.

### Scope

- Introduce the minimal `skeem_trash` system-table definition and provisioning support
- Change default `skeem delete` behavior to move records into trash before removing them from the source collection
- Add a narrow `skeem restore <collection> <id>` path for restoring a trashed record
- Keep auto-expiry, purge jobs, and `--hard` delete semantics narrow unless they fall out cleanly

### Deliverables

- `skeem init` support for provisioning `skeem_trash`
- Soft-delete writes that capture snapshot, actor metadata, and provenance linkage
- `skeem restore` for the happy path where the source id is free to reclaim
- Unit or integration coverage for:
- trash record shaping
- restore eligibility checks
- Smoke coverage that:
- soft deletes a record
- verifies the live record disappears
- verifies a trash entry exists
- restores the record and verifies it is readable again

### Exit criteria

- Normal deletes become reversible in the common case, without needing direct database access or manual recovery steps

### Completion Notes

- Added `skeem_trash` to the supported system-table set and `skeem init` provisioning flow
- Changed default `skeem delete` behavior to soft delete into `skeem_trash`
- Added `skeem delete --hard` to bypass trash intentionally
- Added `skeem restore <collection> <id>` for happy-path recovery when the source id is free
- Reused the shared runtime so top-level `delete` and `exec` delete now use the same soft-delete semantics
- Trash rows now store:
- original collection and record id
- full pre-delete snapshot
- actor metadata via `deleted_by`
- linked delete provenance ids where available
- Added unit coverage for:
- trash record shaping
- Extended the Directus smoke harness to validate:
- `init` status and provisioning for `skeem_trash`
- soft delete removing a live record while creating a trash entry
- restore re-creating the original record and clearing its trash row
- hard delete bypassing trash

## Slice 15: Claims and Coordination Foundation

Status: next

### Why now

The data lifecycle is now much safer: writes are auditable, updates are versioned, and deletes are reversible. The next logical step is to help multiple agents coordinate around shared records, which is the next major runtime behavior in the spec.

### Scope

- Introduce the minimal `skeem_claims` system-table definition and provisioning support
- Add `skeem claim <collection:id>`
- Add `skeem claims <collection:id>`
- Add `skeem release <collection:id>`
- Support lease durations and ignore expired claims in read paths
- Keep automatic renewal, wait queues, and broad policy controls out of scope

### Deliverables

- `skeem init` support for provisioning `skeem_claims`
- Claim acquisition with actor and lease metadata
- Readable status output for active vs expired claims
- Release behavior that validates actor ownership where appropriate
- Unit or integration coverage for:
- lease parsing
- expired claim filtering
- actor ownership checks
- Smoke coverage that:
- acquires a claim
- reads active claim state
- releases it
- verifies expired claims do not block new work

### Exit criteria

- Concurrent agents can coordinate on a record using lightweight leases without inventing external locking infrastructure

## Recommended Order

1. Slice 1: Discovery Completeness
2. Slice 2: Relation-Aware Create Path
3. Slice 3: `exec` and DAG Hardening
4. Slice 4: Config and Cache Polish
5. Slice 5: Schema Diff Foundation
6. Slice 6: `define` Planning and Guardrails
7. Slice 7: Schema Mutation Expansion
8. Slice 8: Higher-Level Data Verbs
9. Slice 9: Exec Verb Parity
10. Slice 10: Identity and Alias Resolution
11. Slice 11: System Initialization and Provisioning
12. Slice 12: Provenance Tracking Foundation
13. Slice 13: Version History Foundation
14. Slice 14: Soft Delete and Restore Foundation
15. Slice 15: Claims and Coordination Foundation

## Not Next

These are intentionally not part of the immediate next slice:

- extension loading
- tool schema generation
- additional adapters
