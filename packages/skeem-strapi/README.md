# @skeems/strapi

Strapi adapter for [skeem](https://github.com/ambirex/skeem), the relational-aware CLI for headless backends built for AI agents.

Targets **Strapi v5**.

## Usage

```sh
npm install -g skeem @skeems/strapi
```

Configure `.skeemrc.yaml`:

```yaml
adapter: strapi
connection:
  url: http://localhost:1337
  token: your-api-token        # a full-access API token (Bearer) for CRUD
  # Schema introspection (ls/describe/discover) needs an admin login:
  email: admin@example.com
  password: ${STRAPI_ADMIN_PASSWORD}
  # ...or supply a pre-obtained admin JWT instead of email/password:
  # adminToken: ${STRAPI_ADMIN_TOKEN}
```

## Tier: Data

Strapi mutates content types only in development mode (and with a server
restart), so this adapter is **data-tier**: it supports discovery and CRUD but
**not** schema mutation. `skeem define` and `skeem init` fail with skeem's
standard "adapter does not support …" capability errors.

| Capability | Supported |
| --- | --- |
| `ls`, `describe`, `discover`, `diff` | ✅ |
| `get`, `find`, `create`, `update`, `delete`, `count` | ✅ |
| `define` (create/alter collections & fields) | ❌ (define content types in Strapi) |
| `init`, `claim`, system features | ❌ (no `skeem_*` content types) |

### Two credentials

Strapi separates auth: the **API token** (Bearer) authorizes the public
`/api/*` data routes, while schema introspection reads the admin
content-type-builder API, which **rejects API tokens** and needs an **admin
JWT**. Provide `email`/`password` (the adapter logs in and caches the JWT) or a
ready `adminToken`. With only an API token, CRUD against a known collection
works but discovery does not.

### Identifiers

Strapi v5 keys records by `documentId` (a string). The adapter canonicalizes it
to `id`, so `skeem get companies <id>` takes the `documentId` and records expose
it as `id` — consistent with the other adapters.

### Draft & Publish

The adapter reads and writes the default (published) view. For content types
with Draft & Publish enabled, freshly created entries are drafts and will not
appear in reads until published. Disable Draft & Publish on a type, or publish
entries through Strapi, if you need immediate read-after-write.

### Type mapping

| Strapi attribute | skeem |
| --- | --- |
| string, email, password, uid | string |
| text, richtext | text |
| integer, biginteger | integer |
| float, decimal | float |
| boolean | boolean |
| date | date |
| datetime, time | datetime |
| json, blocks, media | json |
| enumeration | string + enum |
| relation (`manyToOne`/`oneToOne`) | m2o |
| relation (`oneToMany`) | o2m |
| relation (`manyToMany`) | m2m |

`component` and `dynamiczone` attributes are omitted.
