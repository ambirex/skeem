# @skeems/nocodb

NocoDB adapter for [skeem](https://github.com/ambirex/skeem), the relational-aware CLI for headless backends built for AI agents.

## Usage

Install alongside the `skeem` CLI:

```sh
npm install -g skeem @skeems/nocodb
```

Configure `.skeemrc.yaml`:

```yaml
adapter: nocodb
connection:
  url: http://localhost:8080
  token: your-xc-token          # an API token created in NocoDB
  base: pXXXXXXXXXXXXXX          # base id; optional if the instance has one base
```

NocoDB addresses tables and columns by id rather than name, so the adapter keeps
a small catalog that resolves skeem's name-based contract onto those ids. The
catalog refreshes after every schema change.

If `connection.base` is omitted and the instance hosts exactly one base, the
adapter selects it automatically; otherwise it lists the available base ids in
the error so you can pin one.

## Tier

**Full** — discovery, CRUD, schema mutation (`define`), and system features
(`init`, `claim`).

### Type mapping

| skeem        | NocoDB (uidt)                          |
| ------------ | -------------------------------------- |
| string       | SingleLineText                         |
| text         | LongText                               |
| integer      | Number                                 |
| float        | Decimal                                |
| boolean      | Checkbox                               |
| date         | Date                                   |
| datetime     | DateTime                               |
| json         | JSON                                   |
| string+enum  | SingleSelect (`colOptions.options`)    |

The primary key is canonicalized to `id` (NocoDB's default `Id` column is
aliased), so records and references look the same across adapters. System
columns (`CreatedTime`, `LastModifiedTime`, etc.) and virtual columns
(`Formula`, `Lookup`, `Rollup`, …) are omitted from the schema.

### Relations

`LinkToAnotherRecord` maps to skeem relations: `bt` → `m2o`, `hm` → `o2m`,
`mm` → `m2m`. m2o relations work fully (`skeem link` sets the foreign key), and
m2m relations can be created via `define`.

NocoDB hides its `mm` junction table, but exposes a dedicated nested-link
endpoint, so record-level m2m `link`/`unlink` works: skeem calls
`POST`/`DELETE /api/v2/tables/{table}/links/{column}/records/{id}` rather than
writing a junction row. NocoDB does not report whether a link already existed, so
the link operation is idempotent and always reports success.
