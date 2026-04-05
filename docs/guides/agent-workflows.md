# Agent Workflows

`skeem` is designed to fit agent loops: discover first, act with stable JSON, and leave enough coordination metadata behind that another agent can understand what happened.

## Default Operating Mode

For agent use, prefer:

- `--json` on every command
- `--actor` on every write or claim-related operation
- `--context` when a task, run, or job id matters
- `--idempotency-key` on retriable write operations

Example:

```bash
skeem create companies \
  --name "Acme" \
  --industry Manufacturing \
  --actor planner-1 \
  --context '{"task":"seed-demo","run":"demo-42"}' \
  --idempotency-key create-company-acme \
  --json
```

## Discovery First

A safe agent loop usually begins here:

```bash
skeem ls --json
skeem describe companies --json
skeem discover companies people --json
```

This keeps the agent aligned with the live backend instead of guessing relation names or field shapes.

## Initialize Coordination Features Early

If the workflow will involve retries, claims, annotations, or auditability, initialize the system tables first:

```bash
skeem init --json
```

The current system surface includes:

- aliases
- provenance
- versions
- trash
- claims
- annotations
- idempotency metadata on writes

## Claim Before Mutating Shared Records

Claims are the simplest coordination primitive for multi-agent work:

```bash
skeem claim companies:1 --lease 15m --purpose "enrichment" --actor agent-a --json
skeem claims companies:1 --json
skeem release companies:1 --actor agent-a --json
```

Claims require `--actor` or a configured actor.

## Use Idempotency On Retriable Writes

The current runtime supports idempotent replay for:

- `create`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`
- `annotate`

If the same `--idempotency-key` is reused with the same normalized request, `skeem` returns the stored result instead of writing again. If the same key is reused with different input, the command fails with a validation error.

Current limitation:

- `exec` does not support idempotency replay yet and rejects `--idempotency-key`.

## Use Exec For Compact Multi-Step Plans

`skeem exec` reads a JSON plan from stdin and resolves `$ref.field` dependencies between operations.

Example:

```json
{
  "operations": [
    {
      "ref": "company",
      "op": "upsert",
      "collection": "companies",
      "match": { "name": "Acme" },
      "data": { "industry": "Robotics" }
    },
    {
      "ref": "person",
      "op": "create",
      "collection": "people",
      "data": {
        "name": "Jane",
        "company_id": "$company.id"
      }
    }
  ]
}
```

Run it like this:

```bash
skeem exec --json < plan.json
```

Supported `exec` operations today:

- `create`
- `get`
- `find`
- `findOne`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`

## Alias-Aware Resolution

When aliases are initialized, `skeem` can use alias-backed identity resolution in relation-aware workflows and higher-level verbs.

Example:

```bash
skeem alias add companies:1 acme --json
skeem alias search companies acme --json
```

This becomes useful when agents refer to records by stable names rather than numeric ids.

## Recommended Agent Sequence

1. `skeem init --json`
2. `skeem ls --json`
3. `skeem describe <collection> --json`
4. Claim shared records if coordination matters.
5. Perform writes with `--actor`, `--context`, and `--idempotency-key`.
6. Use `annotate` or provenance context to leave breadcrumbs for later runs.

## Output Contract

Success responses use a stable envelope:

```json
{
  "ok": true,
  "operation": "create",
  "collection": "companies",
  "data": {
    "id": 1,
    "name": "Acme"
  }
}
```

Errors use a parallel envelope:

```json
{
  "ok": false,
  "operation": "create",
  "collection": "companies",
  "error": {
    "code": "VALIDATION",
    "message": "Field \"name\" is required."
  }
}
```

The exact payload varies by command, but the `ok` split and top-level shape stay consistent.
