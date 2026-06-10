# Configuration Reference

`skeem` loads configuration from YAML, environment variables, and CLI flags.

## File Locations

`skeem` searches upward from the current working directory for:

- `.skeemrc.yaml`

It also reads the user-level config at:

- `~/.config/skeem/config.yaml`

The working-directory config is merged over the user-level config.

## Resolution Order

The current runtime resolves config in this order:

1. Read global config from `~/.config/skeem/config.yaml`
2. Read nearest `.skeemrc.yaml` from the current directory or an ancestor
3. Merge local config over global config
4. Select a profile from `--profile`, `SKEEM_PROFILE`, or `default`
5. Merge the selected profile over the base config
6. Apply environment overrides
7. Apply CLI overrides
8. Interpolate `${ENV_VAR}` strings in the final config

## Supported Fields

```yaml
default: local
actor: agent-name

profiles:
  local:
    adapter: directus
    connection:
      url: http://127.0.0.1:8055
      token: ${DIRECTUS_TOKEN}

schema:
  aliases:
    person: people
  exclude:
    - directus_*

cache:
  ttl_seconds: 3600
```

Top-level fields:

- `default`: default profile name
- `actor`: default actor used by claim, annotation, provenance, and related workflows
- `profiles`: named profile map
- `schema.aliases`: collection-name aliases used during CLI resolution
- `schema.exclude`: collection globs or names filtered out of schema-facing commands
- `cache.ttl_seconds` or `cache.ttl_ms`: schema cache TTL
- `extensions`: reserved extension config bucket

## Adapters

The `adapter` field selects the backend. Each adapter ships as its own package
(a dependency of the CLI) and reads the same `connection` block, but the auth and
extra keys differ:

| Adapter | Package | Tier | `connection` keys |
| --- | --- | --- | --- |
| `directus` (default) | `@skeems/directus` | Full | `url`, `token` |
| `pocketbase` | `@skeems/pocketbase` | Full | `url`, and either `token` (superuser token) or `email` + `password` |
| `nocodb` | `@skeems/nocodb` | Full | `url`, `token` (an `xc-token` API token), `base` (base id; optional when the instance hosts one base) |
| `strapi` | `@skeems/strapi` | Data | `url`, `token` (API token, for CRUD), and `email` + `password` or `adminToken` (for schema introspection) |
| `wikidata` | `@skeems/wikidata` | Read | `url` (default `https://www.wikidata.org`), `language` (default `en`); no auth |

```yaml
# PocketBase via email/password
adapter: pocketbase
connection:
  url: http://127.0.0.1:8090
  email: admin@example.com
  password: ${POCKETBASE_PASSWORD}
```

```yaml
# NocoDB with an explicit base id
adapter: nocodb
connection:
  url: http://127.0.0.1:8080
  token: ${NOCODB_TOKEN}
  base: pXXXXXXXXXXXXXX
```

```yaml
# Strapi (data tier): API token for CRUD, admin login for introspection
adapter: strapi
connection:
  url: http://127.0.0.1:1337
  token: ${STRAPI_API_TOKEN}
  email: admin@example.com
  password: ${STRAPI_ADMIN_PASSWORD}
```

Strapi is **data-tier**: discovery and CRUD work, but `define`/`init` are
unsupported (Strapi content types are code-defined). Introspection uses the
admin content-type-builder API, which rejects API tokens — hence the admin
credentials.

```yaml
# WikiData (read-only knowledge graph) — no auth
adapter: wikidata
connection:
  url: https://www.wikidata.org
  language: en
```

WikiData is **read-tier**: `ls`/`describe`/`discover`/`get`/`find` only. It
exposes two synthetic collections (`items`, `properties`); writes are rejected.

Adapter-specific behavior and limitations are documented in each package's
README (for example, PocketBase and NocoDB introspect many-to-many relations but
do not support record-level `link`/`unlink` over them).

## Environment Variables

Supported env overrides:

- `SKEEM_PROFILE`
- `SKEEM_ADAPTER`
- `SKEEM_URL`
- `SKEEM_TOKEN`
- `SKEEM_ACTOR`

Any string value in the YAML config can also interpolate environment variables using `${NAME}`.

## CLI Overrides

The following CLI flags override config:

- `--adapter`
- `--url`
- `--token`
- `--profile`
- `--actor`
- `--context`
- `--idempotency-key`

## Cache Behavior

The schema cache currently lives under the resolved root directory at `.skeem/cache`. In practice, that means it is usually scoped to the workspace that owns the active `.skeemrc.yaml`, or the current working directory when no local config file is present.

Useful commands:

```bash
skeem cache show --json
skeem cache clear --json
skeem ls --refresh --json
skeem ls --no-cache --json
```

`cache show` returns the cache directory, schema path, meta path, TTL, and age when available.

## Example: Multiple Profiles

```yaml
default: staging
actor: docs-agent

profiles:
  staging:
    adapter: directus
    connection:
      url: ${STAGING_URL}
      token: ${STAGING_TOKEN}

  local:
    adapter: directus
    connection:
      url: http://127.0.0.1:8055
      token: ${LOCAL_TOKEN}
```

Use it like this:

```bash
skeem ls --profile local --json
```
