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

### Limitations

- **m2m relation writes are not supported.** PocketBase does not use junction collections; many-to-many is stored as an array of IDs on a `relation` field. skeem's `define` can introspect m2m relations read-only, but cannot create or update them. Use m2o relations or model the junction explicitly.
- Unique constraints are stored as SQL `CREATE UNIQUE INDEX` statements and are single-column only.
