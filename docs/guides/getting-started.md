# Getting Started

This guide assumes you are running `skeem` from this repository against a Directus instance.

Examples use `skeem` as the command name. From source, either run `node packages/skeem/dist/bin/skeem.js ...` or link the workspace package locally after `npm run build`.

## Prerequisites

- Node.js 20+
- A reachable Directus instance
- A Directus token with access to the collections you want to inspect or mutate

## Install

```bash
npm install
npm run build
```

If you want the full local fixture that the repo uses in CI-style smoke runs:

```bash
npm run smoke:directus
```

## Configure A Connection

Create `.skeemrc.yaml` in your working directory:

```yaml
default: local
actor: bootstrap-agent

profiles:
  local:
    adapter: directus
    connection:
      url: http://127.0.0.1:8055
      token: ${DIRECTUS_TOKEN}

schema:
  exclude:
    - directus_*

cache:
  ttl_seconds: 3600
```

You can also override config at runtime with `--url`, `--token`, `--profile`, `--actor`, `--context`, and `--idempotency-key`.

## Verify The Backend

Start with discovery commands:

```bash
skeem ls --counts
skeem describe companies
skeem discover -o schema.skeem.yaml
skeem cache show
```

Useful habits:

- Use `--json` for anything an agent or script will parse.
- Use `--refresh` when you know the schema changed underneath the cache.
- Use `--no-cache` when you need a one-off uncached introspection.

## Read And Write Data

Basic CRUD:

```bash
skeem create companies --name "Acme" --industry Manufacturing --json
skeem get companies 1 --json
skeem find companies --where name=Acme --json
skeem update companies 1 --industry Robotics --json
skeem delete companies 1 --json
skeem restore companies 1 --json
```

Higher-level verbs:

```bash
skeem upsert companies --match name=Acme --industry Robotics --json
skeem link people:1 companies:1 --json
skeem unlink people:1 companies:1 --json
```

By default, `delete` is soft delete and writes to `skeem_trash`. Use `--hard` to bypass trash.

## Initialize System Tables

When you want aliases, provenance, versions, annotations, claims, and other agent-oriented helpers, initialize the `skeem_*` tables:

```bash
skeem init --json
skeem init --status --json
```

`init` is safe to re-run.

## Manage Schema

The core schema workflow is:

```bash
skeem discover -o schema.skeem.yaml
skeem diff schema.skeem.yaml --json
skeem define schema.skeem.yaml --dry-run --json
skeem define schema.skeem.yaml --yes --json
```

`diff` supports `--direction define|discover` depending on whether the file or the live backend is the desired truth.

## Local Development Loop

Common commands while working in the repo:

```bash
npm run build
npm run test
npm run smoke:directus
```

Key docs from here:

- [Agent Workflows](/Users/brent/dev/skeem/docs/guides/agent-workflows.md)
- [CLI Reference](/Users/brent/dev/skeem/docs/reference/cli.md)
- [Configuration Reference](/Users/brent/dev/skeem/docs/reference/configuration.md)
