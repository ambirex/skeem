# CLI Reference

Examples use `skeem` as the command name. From source, run the built binary directly or link the workspace package after `npm run build`.

## Global Flags

These flags are parsed before command dispatch:

- `--adapter <name>`
- `--url <backend-url>`
- `--token <backend-token>`
- `--profile <profile-name>`
- `--json`
- `--no-cache`
- `--refresh`
- `--dry-run`
- `--yes`
- `--verbose`
- `--no-rollback`
- `--allow-destructive`
- `--actor <name>`
- `--context <json-object>`
- `--idempotency-key <key>`

Notes:

- `--context` must be a JSON object.
- Some flags only matter for certain commands. For example, `--allow-destructive` applies to schema mutations and `--no-rollback` applies to compound data writes.

## Discovery

```bash
skeem ls [--counts]
skeem describe <collection>
skeem discover [collection ...] [-o path]
skeem cache show
skeem cache clear
```

Use discovery commands to inspect the live backend before acting.

## Data Reads

```bash
skeem get <collection> <id> [--expand relation]
skeem find <collection> [--where field=value] [--limit N] [--offset N] [--sort field] [--expand relation]
```

`find` currently uses equality-style filtering with repeated `--where` flags.

## Data Writes

```bash
skeem create <collection> [--field value]
skeem update <collection> <id> [--field value]
skeem upsert <collection> --match field=value [--field value]
skeem delete <collection> <id> [--hard]
skeem restore <collection> <id>
skeem link <collection:id> <related_collection:id>
skeem link <collection:id> <relation> <target>
skeem unlink <collection:id> <related_collection:id>
skeem unlink <collection:id> <relation> <target>
```

Behavior highlights:

- `delete` is soft delete by default and writes to trash.
- `--hard` bypasses trash.
- `upsert` uses repeated `--match` flags for the lookup filter.
- `link` and `unlink` handle both direct relation shorthand and explicit relation syntax.

## Schema Management

```bash
skeem diff <schema-file> [--direction define|discover]
skeem define <schema-file> [--dry-run] [--yes] [--allow-destructive]
```

Typical flow:

```bash
skeem discover -o schema.skeem.yaml
skeem diff schema.skeem.yaml --json
skeem define schema.skeem.yaml --dry-run --json
skeem define schema.skeem.yaml --yes --json
```

## System Features

```bash
skeem init [--status]
skeem alias add <collection:id> <alias>
skeem alias list <collection:id>
skeem alias remove <collection:id> <alias>
skeem alias search <collection> <term>
skeem claim <collection:id> --lease <duration> [--purpose text]
skeem claims <collection:id>
skeem release <collection:id>
skeem annotate <collection:id> --key <name> --value <json> [--expires <duration>]
```

These commands rely on or interact with `skeem_*` system tables.

## Exec

```bash
skeem exec < plan.json
```

Input shape:

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

Supported `op` values:

- `create`
- `get`
- `find`
- `findOne`
- `update`
- `delete`
- `upsert`
- `link`
- `unlink`

Current caveat:

- `exec` rejects `--idempotency-key` for now.

## Output

Use `--json` for machine-readable output. Success envelopes use:

```json
{
  "ok": true,
  "operation": "find",
  "collection": "companies",
  "data": [],
  "count": 0
}
```

Error envelopes use:

```json
{
  "ok": false,
  "operation": "find",
  "collection": "companies",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```
