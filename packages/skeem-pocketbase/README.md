# @skeems/pocketbase

PocketBase adapter for [skeem](https://github.com/ambirex/skeem), the relational-aware CLI for headless backends built for AI agents.

## Usage

Install alongside the `skeem` CLI:

```sh
npm install -g skeem @skeems/pocketbase
```

Configure `.skeemrc.yaml`:

```yaml
adapter: pocketbase
connection:
  url: http://localhost:8090
  # Authenticate with a superuser token:
  token: your-superuser-token
  # Or with email/password:
  # email: admin@example.com
  # password: yourpassword
```

## PocketBase version

Requires PocketBase **v0.23+** (flat field schema API).

## Tier

**Full** — supports discovery, CRUD, schema mutation (`define`), system features (`init`, `claim`).

### Relations

PocketBase stores many-to-many as an array of related ids on a `relation` field
(no junction collection). Record-level linking works: `skeem link`/`unlink`
read-modify-write that array. m2o relations work fully (`skeem link` sets the id).

What is **not** supported is creating or altering an m2m relation's *schema* via
`define` — `define` introspects m2m relations read-only and `createRelation`
for an m2m surfaces a clear capability error. Define the relation field in
PocketBase, then use `skeem link`/`unlink` to manage the records.

### Limitations

- m2m relation *schema* mutation via `define` is unsupported (record linking is).
- Unique constraints are stored as SQL `CREATE UNIQUE INDEX` statements and are single-column only.
