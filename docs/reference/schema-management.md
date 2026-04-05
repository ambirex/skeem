# Schema Management

The current schema surface is built around four verbs:

- `describe`
- `discover`
- `diff`
- `define`

The implementation is Directus-first and geared toward a schema-as-code workflow.

## Describe

```bash
skeem describe <collection>
```

`describe` returns:

- fields
- primary key
- relations
- unique constraints
- record count when the adapter can provide it

This is the fastest way to understand one collection before writing data or schema changes.

## Discover

```bash
skeem discover [collection ...]
skeem discover [collection ...] -o schema.skeem.yaml
```

`discover` exports the live backend to a declarative schema document. You can:

- scope the export to one or more collections
- write YAML directly to a file
- use the output as the source for `diff` and `define`

## Diff

```bash
skeem diff <schema-file> [--direction define|discover]
```

Directions:

- `define`: treat the file as truth and explain how live schema should change
- `discover`: treat live schema as truth and explain how the file should change

`diff` reports:

- collections only in file
- collections only in live
- field mismatches
- relation mismatches
- many-to-many drift
- summary counts

Use `--json` when you want a structured drift report.

## Define

```bash
skeem define <schema-file> --dry-run --json
skeem define <schema-file> --yes --json
skeem define <schema-file> --yes --allow-destructive --json
```

`define` turns a schema document into an ordered plan, then optionally applies it.

The dry-run output includes:

- the ordered plan
- which steps are executable
- which steps are destructive
- which steps are blocked or skipped

## Current Directus Coverage

The current implementation supports a meaningful schema workflow, including:

- collection creation
- field creation
- safe field updates
- relation creation
- relation updates
- many-to-many relation creation and removal
- destructive schema actions behind `--allow-destructive`

The safest workflow remains:

1. `discover`
2. edit the schema file
3. `diff`
4. `define --dry-run`
5. `define --yes`
6. `diff` again to confirm zero drift

## Example Flow

```bash
skeem discover -o schema.skeem.yaml
skeem diff schema.skeem.yaml --json
skeem define schema.skeem.yaml --dry-run --json
skeem define schema.skeem.yaml --yes --json
skeem diff schema.skeem.yaml --json
```

## Notes

- Junction collections stay hidden from the normal `ls` output.
- `discover` is usually the best starting point if you are onboarding an existing Directus project.
- When a schema mutation is too risky or unsupported, `define` keeps it visible in the plan instead of silently pretending it was applied.
