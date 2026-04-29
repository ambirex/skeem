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
- Completed: Slice 15: Claims and Coordination Foundation
- Completed: Slice 16: Annotations Foundation
- Completed: Slice 17: Idempotency Foundation
- Completed: Slice 18: Extension Registry Foundation
- Completed: Slice 19: Read Source Foundation
- Completed: Slice 20: Second Read Source (Open Library)
- Completed: Slice 21: Wikidata Cross-Provider Identity Hub

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

Status: completed

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

### Completion Notes

- Added `skeem_claims` to the supported system-table set and `skeem init` provisioning flow
- Added `skeem claim <collection:id> --lease <duration>`
- Added `skeem claims <collection:id>`
- Added `skeem release <collection:id>`
- Added shared lease helpers for:
- duration parsing
- expiration checks
- actor resolution from CLI or config
- Implemented runtime behavior so:
- `claim` auto-provisions the claim store on first write
- expired leases are ignored and cleaned up best-effort
- conflicting active claims fail with a validation error
- release validates ownership before deleting active claim rows
- Added unit coverage for:
- lease parsing
- lease expiry detection
- actor resolution
- Extended the Directus smoke harness to validate:
- `init` status and provisioning for `skeem_claims`
- claim acquisition and status reads
- wrong-owner release rejection
- explicit release
- expired lease cleanup and reacquire

## Slice 16: Annotations Foundation

Status: completed

### Why now

Claims let multiple agents avoid stepping on each other. The next small but high-value runtime primitive is lightweight metadata about records that should not live in the source schema itself.

### Scope

- Introduce the minimal `skeem_annotations` system-table definition and provisioning support
- Add `skeem annotate <collection:id> --key <name> --value <json>`
- Support optional TTL via `--expires <duration>`
- Keep annotation querying on the existing `find skeem_annotations ...` path for now
- Defer annotation indexes, policy controls, and higher-level query sugar

### Deliverables

- `skeem init` support for provisioning `skeem_annotations`
- Annotation writes that store collection, record id, key, parsed JSON value, actor, and expiry metadata
- Shared duration parsing or expiry helpers where that avoids drift with claims/trash behavior
- Unit or integration coverage for:
- JSON value parsing
- expiry shaping
- actor metadata
- Smoke coverage that:
- writes an annotation
- reads it back through `find skeem_annotations`
- verifies expiry metadata is persisted when requested

### Exit criteria

- Agents can attach scoped metadata to records without polluting business collections or inventing ad hoc side tables

### Completion Notes

- Added `skeem_annotations` to the supported system-table set and `skeem init` provisioning flow
- Added `skeem annotate <collection:id> --key <name> --value <json> [--expires <duration>]`
- Added shared annotation helpers for:
- JSON value parsing
- key normalization
- actor fallback from CLI or config
- optional expiry timestamp shaping
- Factored duration parsing into a shared helper used by both claims and annotations
- Implemented runtime behavior so:
- `annotate` verifies the target record exists
- the annotation store is auto-provisioned on first write
- `--dry-run` previews the annotation payload and plan
- annotations are written as append-only metadata rows
- Extended the Directus smoke harness to validate:
- `init` status and provisioning for `skeem_annotations`
- annotation dry-run
- numeric and string annotation writes
- reading annotations back through `find skeem_annotations`
- expiry metadata persistence

## Slice 17: Idempotency Foundation

Status: completed

### Why now

The runtime now has most of the write primitives in place, plus provenance rows that already store idempotency keys. The next logical step is turning that stored metadata into actual replay protection for repeated write requests.

### Scope

- Add shared idempotency lookup and replay logic backed by `skeem_provenance`
- Support idempotent replays for the highest-value write verbs first:
- `create`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`
- `annotate`
- Defer full schema-write parity until the core data verbs are proven

### Deliverables

- Runtime helpers that detect an existing `--idempotency-key` before executing a write
- Stable replay envelopes that return the original result shape instead of mutating again
- Clear provenance conventions for storing any replay metadata needed by the runtime
- Unit or integration coverage for:
- first execution vs replay
- mismatched payloads with the same key
- replay across multiple write verbs
- Smoke coverage that:
- reruns a create with the same idempotency key
- verifies no duplicate row is created
- reruns another write verb with the same key and gets a stable replay result

### Exit criteria

- Repeating a write with the same idempotency key becomes safe and predictable for agents and automation

### Completion Notes

- Added shared idempotency helpers for:
- request matching
- replay metadata storage inside provenance input refs
- replay metadata extraction for future requests
- Added top-level idempotency replay support for:
- `create`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`
- `annotate`
- Added request-shape validation so reusing the same idempotency key for a different request fails with a validation error
- Kept `skeem exec` explicitly out of scope for now with a clear usage error instead of ambiguous partial behavior
- Prevented nested compound child writes from reusing top-level idempotency keys, so replay remains unambiguous for root operations
- Added unit coverage for:
- metadata attachment and extraction
- request matching
- mismatch detection helpers
- Extended the Directus smoke harness to validate:
- create replay without duplicates
- mismatch rejection for reused keys
- update replay without extra version rows
- upsert replay
- delete replay without extra trash rows
- link and unlink replay
- annotate replay without duplicate annotation rows

## Slice 18: Extension Registry Foundation

Status: completed

### Why now

The core runtime is now covering the main system-table and data-operation foundations described in Part IV. The next major product surface in the spec is the extension system, and the smallest sensible start is the registry and status layer before full installation flows.

### Scope

- Introduce the minimal `skeem_extensions` system-table definition and provisioning support
- Add read-only or low-risk extension commands first:
- `skeem extend list`
- `skeem extend status`
- Add manifest loading primitives for local extension packages
- Defer full install/apply hooks and custom command loading until the registry shape is proven

### Deliverables

- `skeem init` support for provisioning `skeem_extensions`
- Shared manifest parsing for `skeem-extension.yaml`
- `extend list` output for discovered local or bundled extension manifests
- `extend status` output backed by `skeem_extensions`
- Unit or integration coverage for:
- manifest parsing
- registry row shaping
- list/status output
- Smoke coverage that:
- provisions `skeem_extensions`
- reads at least one manifest fixture
- records or reports extension status cleanly

### Exit criteria

- The repo has a real extension registry foundation that future install/apply work can build on without redesigning the CLI or system table

### Completion Notes

- Added `skeem_extensions` to the supported system-table set and `skeem init` provisioning flow
- Added manifest primitives in a new `extensions/` module:
- `parseExtensionManifest` for YAML-driven manifest parsing with explicit field validation
- `loadExtensionManifest` for file-backed reads
- `discoverExtensionManifests` for scanning a configurable extensions root
- Defaulted the extensions root to `<rootDir>/extensions` and made it overridable via the `extensions.path` config entry
- Added a registry helper that joins discovered manifests with rows from `skeem_extensions` and classifies each entry as `available`, `installed`, `version_drift`, or `installed_without_manifest`
- Added `skeem extend list` for read-only manifest discovery output
- Added `skeem extend status` backed by `skeem_extensions`, which gracefully reports the registry as not provisioned without erroring
- Added unit coverage for:
- manifest parsing happy paths and rejection of missing or malformed fields
- discovery scanning, sort order, and missing-root behavior
- registry status classification across available, installed, drifted, and orphan rows
- system-table fields and status shaping for the new `skeem_extensions` definition
- Extended the Directus smoke harness to validate:
- `init` status and provisioning for `skeem_extensions`
- `extend list` against a manifest fixture
- `extend status` reporting the fixture as `available` before any rows exist
- `extend status` flipping to `installed` after a row is created in `skeem_extensions`
- cleanup of the inserted fixture row via `delete --hard`

## Slice 19: Read Source Foundation

Status: completed

### Why now

Every adapter slice in the original roadmap was deferred because the runtime was still hardening core Directus behavior. That work is now in place, and the next high-leverage adapter direction is not "another writable backend" but read-only public sources (TMDB, WikiData, Wikipedia) that agents already want to enrich Directus records with. Forcing those through `SkemAdapter` would weaken the contract because most write, schema, and lifecycle verbs are nonsensical for a public API. The smaller move is to introduce a narrower read-source abstraction and prove it against one concrete source before any cross-provider join work.

### Scope

- Introduce a minimal `ReadSource` interface separate from `SkemAdapter`:
- `discover` (static or curated schema)
- `get`
- `find` or `search`
- Keep mutation, schema-mutation, soft-delete, claims, and idempotency verbs explicitly unsupported on read sources
- Pick TMDB as the proving source (stable schema, clean REST, well-known ids)
- Surface read sources under a separately namespaced backend so existing Directus behavior is unaffected
- Reuse existing alias/identity primitives (`skeem_aliases`) for cross-provider identity instead of inventing a new mapping store
- Defer federated `find` across two backends in one call; the join story should be shaped by at least two real sources

### Deliverables

- `ReadSource` interface and shared validation that mutation verbs return a clear "not supported" envelope on read sources
- TMDB read source covering at least:
- `movies` lookup by id
- a single search/find path
- a static curated schema returned from `discover`
- CLI plumbing to address a read source explicitly without colliding with the primary adapter
- Unit coverage for:
- read-source discovery output
- get and find happy-path shaping
- mutation-verb rejection envelopes
- Smoke or integration coverage that:
- discovers the TMDB source schema
- fetches one record by id
- runs one find/search call
- verifies a Directus record can carry a `tmdb:movie:<id>` alias that resolves back to the same lookup

### Exit criteria

- A user can read from one external source through `skeem` with the same envelopes and CLI shape they already use for Directus reads, while the foundation makes future sources (WikiData, Wikipedia) and a real cross-provider join layer straightforward to add

### Completion Notes (Slice 19)

- Introduced a separate `ReadSource` interface in core (`packages/skeem/src/sources/types.ts`) that is intentionally narrower than `SkemAdapter`:
- only `connect`, `describe`, `get`, and `find`
- mutation, schema-mutation, soft-delete, claims, and idempotency verbs are simply not part of the contract, so they do not need explicit "not supported" rejections at the source layer
- Added a `sources:` config section with per-source connection configs (defaults `type` to the entry key when omitted) and full env interpolation through the existing `${VAR}` mechanism
- Created `@skeems/tmdb` as a separate package mirroring the Directus split:
- `createTmdbSource()` factory returning the read-source contract
- v3 `api_key` and v4 `read_token` (Bearer) auth, with curated `movies` schema and projected fields
- `get` for `/movie/{id}` and `find` for `/search/movie`, including paginated traversal across TMDB pages and offset translation
- Added a source registry (`packages/skeem/src/sources/registry.ts`) that knows the supported types, summarizes configured sources, and instantiates them lazily
- Added runtime methods `sourceList`, `sourceDiscover`, `sourceGet`, `sourceFind` and a top-level `skeem source <list|discover|get|find>` CLI subcommand with stable JSON envelopes
- Reused `skeem_aliases` for cross-provider identity instead of inventing a new mapping store: a Directus row can now carry a `tmdb:movie:<id>` alias and be resolved back through the existing alias system
- Added unit coverage for:
- TMDB source happy paths (get, find, pagination, offset translation, bearer auth) and error envelopes via mocked fetch
- registry classification, configured-source summarization, and instantiation guards
- config loader normalization, env interpolation, and default `type` inference for sources
- Extended the Directus smoke harness to validate:
- `skeem source list` surfaces the configured tmdb source and supported types
- `skeem source discover movies` returns the curated tmdb schema (no live API call)
- discovering an unconfigured source fails with a clear "not configured" error
- a Directus `companies` row can carry a `tmdb:movie:27205` alias that resolves back through `alias list` and `alias search`
- live `source get` and `source find` against TMDB are exercised only when `TMDB_API_KEY` is set in the environment

## Slice 20: Second Read Source (Open Library)

Status: completed

### Why now

Slice 19 proved the `ReadSource` contract against a single source (TMDB), but a contract is only as good as the second implementation that has to fit it. Open Library is the cleanest second source: free, no API key, stable string-based OLIDs (different shape from TMDB's integer IDs), and a natural cross-provider identity story via `openlibrary:work:<OLID>` aliases. This is the smallest move that stress-tests the abstraction.

### Scope

- Add `@skeems/openlibrary` as a separate package mirroring `@skeems/tmdb`
- Expose two collections (`works` and `editions`) keyed by OLID
- Cover get for both collections and search-style find for works
- Reuse the existing `skeem source` CLI verb and `skeem_aliases` for cross-provider identity
- Defer authors, ISBN-driven edition find, and federated cross-source query to future slices

### Deliverables

- New `@skeems/openlibrary` package with `createOpenLibrarySource()`:
- auth-free connect with configurable `base_url` and `user_agent`
- curated schema for `works` and `editions` (OLID-string primary keys)
- get on both collections with explicit projection
- search-driven find on works with paginated walking
- explicit rejection envelope for find on editions and unknown collections
- Registered in the core source registry under type `openlibrary`
- Smoke coverage for:
- `skeem source list` surfacing both `movies` (tmdb) and `books` (openlibrary)
- `skeem source discover books` returning the curated works/editions schema
- attaching `openlibrary:work:OL45804W` to a Directus record and resolving it back through `alias list` and `alias search`
- live `source get` and `source find` against Open Library gated behind `OPENLIBRARY_LIVE=1`

### Exit criteria

- A second source ships against the existing `ReadSource` contract without contract churn, and the alias bridge demonstrably handles two independent identifier shapes (integer-keyed TMDB and OLID-string Open Library)

### Completion Notes (Slice 20)

- Added `packages/skeem-openlibrary/` package mirroring the `@skeems/tmdb` layout (package.json, tsconfigs, src split into types/source/index)
- `createOpenLibrarySource()` exposes the same structural shape as TMDB but with:
- string-based OLID primary keys (e.g. `OL45804W`, `OL7353617M`)
- two collections instead of one (`works` searchable, `editions` get-only)
- explicit `find_unsupported_collection` envelope for `editions.find`
- `User-Agent` header per Open Library guidance, defaulting to `skeem-openlibrary/0.1.0` and overridable via config
- Registered the new factory in `packages/skeem/src/sources/registry.ts` under type `openlibrary`
- Wired the new workspace into the root build script and `packages/skeem/package.json` dependency list
- Added 12 unit tests in `packages/skeem-openlibrary/src/source.test.ts` covering:
- describe schema shape
- get on works (with `first_publish_date` → `first_publish_year` parsing)
- get on editions (including `work_id` projection from linked works)
- 404 envelope shaping
- find requires query, sliced limit, paginated walk, offset translation
- editions-find rejection
- unknown-collection rejection
- explicit `base_url` override
- Updated `packages/skeem/src/sources/registry.test.ts` to assert both supported types and added a parallel "instantiate openlibrary" case; refactored a placeholder test to use a clearly-fake type (`imaginary-source`) instead of relying on `openlibrary` being unsupported
- Extended the Directus smoke harness to:
- include `books: openlibrary` alongside `movies: tmdb` in the source workspace `.skeemrc.yaml`
- assert `source list` reports both sources as supported
- assert `source discover books` returns the curated works/editions schema
- attach `openlibrary:work:OL45804W` to a Directus row and verify alias-list/alias-search round-trip
- run live OpenLibrary `source get`/`source find` only when `OPENLIBRARY_LIVE=1`
- Recommended next step (Slice 21 candidate): a Wikidata source as the universal cross-provider join hub. Wikidata exposes typed external-ID properties for TMDB (P4947), OpenLibrary work (P648) and edition (P5331), MusicBrainz (P434/P435/P436), IMDB (P345), DOI (P356), ORCID (P496), GeoNames (P1566), OSM (P402), and many more — adding Wikidata converts today's per-source alias strings into a federated identity layer reachable through Q-IDs.

## Slice 21: Wikidata Cross-Provider Identity Hub

Status: completed

### Why now

Slice 20 proved the `ReadSource` contract holds against a second source with a different identifier shape (string OLIDs vs integer TMDB ids). The next high-leverage move is the universal hub: Wikidata's Q-IDs expose typed external-ID properties for nearly every source we care about, so adding Wikidata turns the alias system from "per-source strings on a record" into a federated identity layer where one record can be addressed by Q-ID, TMDB id, OpenLibrary OLID, IMDB id, or any other supported namespace simultaneously.

### Scope

- Add `@skeems/wikidata` as a third read-source package mirroring the TMDB/OpenLibrary pattern
- Expose a single `entities` collection keyed by Q-ID
- Use the EntityData JSON endpoint for `get` and the `wbsearchentities` Action API for `find` — no SPARQL, no auth, no key
- Curate the entity projection aggressively: label/description/aliases (English by default, configurable), `instance_of` Q-IDs, a curated `external_ids` map for the high-leverage joiner properties, and a `wikipedia` map of site-keyed titles
- Reuse the existing `skeem source` CLI verb and `skeem_aliases` for cross-provider identity
- Defer SPARQL graph queries, multi-language label hydration, statement qualifiers/references, nested entity label resolution, bulk reverse-lookup (foreign id → Q-ID), and federated cross-source query

### Deliverables

- `@skeems/wikidata` package with `createWikidataSource()`:
- auth-free connect with configurable `base_url`, `language`, and `user_agent`
- static `entities` schema with an `external_id_properties` map exposing the curated property bridge for introspection
- get with QID validation and English-fallback localization
- search-driven find with `search-continue` cursor pagination and offset translation
- explicit rejection envelope for malformed Q-IDs, missing entities, and unsupported collections
- Registered in the core source registry under type `wikidata`
- Smoke coverage for:
- `skeem source list` surfacing all three sources (`tmdb`, `openlibrary`, `wikidata`)
- `skeem source discover entities` returning the curated wikidata schema and the `external_id_properties` map
- a single Directus row simultaneously carrying `wikidata:entity:Q42`, `tmdb:person:1212`, `openlibrary:author:OL272947A`, and `imdb:nm0010930` aliases — proving the federated identity story
- alias search resolving the same Directus row from any of those namespaces
- live `source get` and `source find` against Wikidata gated behind `WIKIDATA_LIVE=1`

### Exit criteria

- A Directus row can be addressed by Q-ID and reach back into TMDB, OpenLibrary, IMDB (and every other curated property) through `skeem_aliases` without a federated query layer being introduced

### Completion Notes

- Added `packages/skeem-wikidata/` package mirroring the existing read-source pattern
- `createWikidataSource()` uses the EntityData JSON endpoint for `get` and `wbsearchentities` for `find` — both unauthenticated and key-free
- The curated external-ID property map exposes 22 high-leverage joiner properties (TMDB movie/TV/person, IMDB, OpenLibrary work/edition, ISBN-10/13, MusicBrainz artist/work/release-group/recording, DOI, ORCID, PubMed, arXiv, VIAF, Library of Congress, GeoNames, OSM relation, Freebase legacy, SEC CIK)
- `describe()` returns the `external_id_properties` list alongside the schema so introspection tools can see exactly which Wikidata properties are projected — this is the bridge map for any future federated find work
- Q-ID format is validated up front (`/^Q\d+$/`); property IDs and other entity types are intentionally rejected to keep the contract narrow
- Localized label/description/aliases default to English with English fallback when the configured language is missing
- `external_ids` extraction respects rank — deprecated statements are skipped, the first non-deprecated mainsnak value wins (sufficient for 1:1 external IDs; multi-value handling deferred)
- Wikipedia sitelinks are surfaced as a `{ <site>: { title, url } }` map keyed by stripped site code (e.g. `en`, `de`)
- Find separates per-request page size (`MAX_PAGE_SIZE=50`, the wbsearchentities cap) from overall limit cap (`OVERALL_LIMIT_CAP=200`) — this was a bug caught by the pagination test
- Find pagination uses Wikidata's native `search-continue` cursor; offset translates directly into the initial cursor instead of being translated into pages
- Added 13 unit tests in `packages/skeem-wikidata/src/source.test.ts` covering: describe schema and external_id_properties exposure, base URL validation, Q-ID format validation, full Q42-style get projection, language fallback, missing-entity envelope, 404 handling, find requires query, sliced limit, search-continue pagination, offset cursor translation, unsupported collections, base_url override
- Updated `packages/skeem/src/sources/registry.ts` to register the new factory and `registry.test.ts` to assert all three supported types
- Wired the workspace into the root build script and `packages/skeem/package.json` dependency list
- Extended the Directus smoke harness to:
- include `entities: wikidata` alongside `movies: tmdb` and `books: openlibrary` in the source workspace `.skeemrc.yaml`
- assert `source list` reports all three sources as supported
- assert `source discover entities` returns the curated schema and external-ID property bridge
- create one Directus row that carries `wikidata:entity:Q42`, `tmdb:person:1212`, `openlibrary:author:OL272947A`, and `imdb:nm0010930` aliases simultaneously
- verify the same row is reachable by alias search from at least two different source namespaces (Q-ID and TMDB id)
- run live Wikidata `source get`/`source find` only when `WIKIDATA_LIVE=1`
- Open follow-ups (none needed for foundation, but worth flagging):
- multi-value external-ID handling (e.g., entities with multiple ISBN-13s)
- nested entity-label hydration (`instance_of` returns Q-IDs but not labels — would need a second fetch)
- bulk reverse-lookup ("find Q-ID for `tmdb:movie:603`") via SPARQL
- promoting curated external-id property keys to first-class skeem alias namespaces so `tmdb:movie:603` matches Q-IDs that have P4947=603 without any per-record alias add

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
16. Slice 16: Annotations Foundation
17. Slice 17: Idempotency Foundation
18. Slice 18: Extension Registry Foundation
19. Slice 19: Read Source Foundation
20. Slice 20: Second Read Source (Open Library)
21. Slice 21: Wikidata Cross-Provider Identity Hub

## Not Next

These are intentionally not part of the immediate next slice:

- extension loading and custom command registration
- tool schema generation
- additional writable adapters
- federated cross-provider find/join (now plausible given three sources + a universal hub — but still wants its own design slice)
- promoting curated Wikidata external-id property keys to first-class skeem alias namespaces (so `tmdb:movie:603` resolves through Q-IDs without per-record alias adds)
- additional read sources — MusicBrainz is the strongest next candidate (UUID-keyed, dense music ecosystem cross-references)
