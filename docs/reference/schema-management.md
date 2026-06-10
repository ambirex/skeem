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
- relation mismatches (m2o and m2m)
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

## Relations

Relations live in each collection's `relations` map, keyed by the field name:

```yaml
collections:
  articles:
    fields:
      author_id:
        type: integer
    relations:
      author_id:
        collection: people
        type: m2o
      tags:
        collection: tags
        type: m2m
```

- `collection` is the **related** collection.
- `type` is `m2o` or `m2m` (`o2m` is the inverse of an `m2o` and is created implicitly).

A many-to-many relation is declared on **both** collections (e.g. `articles.tags`
and `tags.articles`); `define` collapses the two sides into a single junction.
`discover` already emits both sides, so a discover → define round-trip is clean.

Junction detail is optional and defaults to a convention
(`<a>_<b>` junction collection, `<collection>_id` foreign keys). Declare it
explicitly only when it diverges from that convention:

```yaml
    relations:
      tags:
        collection: tags
        type: m2m
        relatedField: articles          # inverse field on the related collection
        junctionCollection: article_tag
        junctionField: article_id        # junction FK back to this collection
        inverseJunctionField: tag_id     # junction FK to the related collection
```

Notes and limits:

- Relation changes (m2o target/type) apply as a delete-then-recreate, which is
  **not atomic** — a failure can leave the relation dropped.
- m2m **structural** changes (e.g. a different junction collection) are reported
  as blocked: remove and recreate them deliberately, since dropping a junction
  loses its rows.

## Enum Fields

An enum is a `string` field with an `enum` list:

```yaml
    fields:
      status:
        type: string
        enum: [draft, published, archived]
```

On Directus this maps to a dropdown interface over the listed choices; the
underlying column stays a string. `discover` reads the choices back into
`enum`. Directus choices store a separate label and value — skeem only tracks
the value, so a re-`define` collapses any custom label to equal its value.

## Current Directus Coverage

The current implementation supports a meaningful schema workflow, including:

- collection creation
- field creation (including enum/choice fields)
- safe field updates (including enum choice changes)
- relation creation
- relation updates (m2o, delete-then-recreate)
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
