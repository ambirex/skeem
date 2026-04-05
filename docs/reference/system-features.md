# System Features

`skeem` includes a growing set of `skeem_*` tables and runtime behaviors that make agent-oriented workflows safer and easier to reason about.

## Initialize The System Layer

```bash
skeem init --json
skeem init --status --json
```

`init` is idempotent and provisions the currently supported system tables.

## Current Tables

The current implementation provisions and uses:

- `skeem_aliases`
- `skeem_provenance`
- `skeem_versions`
- `skeem_trash`
- `skeem_claims`
- `skeem_annotations`

Idempotency currently stores replay metadata alongside provenance records rather than in a separate table.

## Aliases

Aliases give records stable, human-friendly identities for later resolution.

```bash
skeem alias add companies:1 acme --json
skeem alias list companies:1 --json
skeem alias search companies acme --json
skeem alias remove companies:1 acme --json
```

Alias-backed resolution is used by parts of relation-aware writes and higher-level verbs when direct field matching is not enough.

## Provenance

Write operations can record:

- actor
- context
- idempotency key
- input references
- result metadata

Set these with:

- `--actor`
- `--context '{"task":"..."}'`
- `--idempotency-key some-key`

Provenance is one of the main reasons to initialize the system layer before running agents against a shared backend.

## Versions

The runtime records update history in `skeem_versions` for:

- `update`
- update-shaped `upsert`
- matching `exec` update paths

Each version row links back to provenance and captures changed fields plus a pre-update snapshot.

## Trash And Restore

`delete` is soft delete by default:

```bash
skeem delete widgets 1 --json
skeem restore widgets 1 --json
skeem delete widgets 1 --hard --json
```

Soft delete writes a snapshot to `skeem_trash`. `--hard` bypasses trash.

## Claims

Claims coordinate shared work across agents:

```bash
skeem claim companies:1 --lease 15m --purpose "enrichment" --actor agent-a --json
skeem claims companies:1 --json
skeem release companies:1 --actor agent-a --json
```

Claims expire automatically based on the lease window. Releasing with the wrong actor fails cleanly.

## Annotations

Annotations attach lightweight metadata to records:

```bash
skeem annotate companies:1 --key note --value '"priority customer"' --json
skeem annotate companies:1 --key quality_score --value 0.92 --expires 7d --json
```

Values are parsed as JSON, so strings should be quoted JSON strings when passed on the CLI.

## Idempotency

Idempotent replay is supported for:

- `create`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`
- `annotate`

If a write is retried with the same `--idempotency-key` and the same normalized request, the runtime returns the stored response. If the same key is reused for a different request, the runtime raises a validation error.

Current caveat:

- `skeem exec` does not support idempotency replay yet.

## Recommended Operational Pattern

1. Run `skeem init --json`
2. Always set `--actor` on writes and claims
3. Add `--context` for task-level provenance
4. Add `--idempotency-key` for retriable writes
5. Use claims around contested records
