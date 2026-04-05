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
