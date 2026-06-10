# Adapter Roadmap

A ranked menu of candidate backend integrations, ordered by how welcome each would be to the people who actually run a tool like skeem: self-hosters, indie hackers, agencies, and agent/automation builders. This is a prioritization menu, not a commitment — adapters carry permanent maintenance cost, and the realistic solo pace is two or three per year. The long tail belongs to community contributors once an adapter authoring guide and conformance kit exist.

**Shipped so far:** Directus (`@skeems/directus`, the original, Full), PocketBase (`@skeems/pocketbase`, Full), NocoDB (`@skeems/nocodb`, Full), Strapi (`@skeems/strapi`, **Data**), and WikiData (`@skeems/wikidata`, **Read** — see below). Each full/data adapter is wired into the cross-adapter conformance suite under `test/conformance/` (Strapi runs the data-tier subset against a user-provided instance). That completes the plan's "suggested first three" (plus Strapi); Supabase is the natural next Full-tier target.

**Read tier (new):** beyond Full/Data/Content, WikiData established a **Read** tier — introspection + `get`/`find` only, no writes. WikiData (`@skeems/wikidata`) maps its knowledge graph to two synthetic collections (`items`, `properties`) over the public MediaWiki/Wikibase API (no auth), with a live smoke (`npm run smoke:wikidata`) rather than a conformance fixture since there's nothing to provision or seed. This shows the adapter abstraction extends to read-only reference sources, not just writable backends — relevant for other public read APIs (PostgREST read-only, OpenStreetMap/Nominatim, etc.).

## How the ranking works

Each candidate is scored on four questions:

1. **Audience overlap** — do the people who run this backend also point agents at it?
2. **Technical fit** — can the backend honor the `SkemAdapter` contract? Specifically: schema introspection with real relations, CRUD at the API level, schema mutation via API (`define`), and the ability to create `skeem_*` collections for system features.
3. **Differentiation** — does skeem add real value over the backend's own CLI/SDK/MCP tooling?
4. **Testability** — can it run as a Docker fixture in the smoke harness, or does it require a hosted sandbox account?

**Capability tiers** (declared per adapter; the contract's optional schema methods already support this):

- **Full** — introspection, CRUD, schema mutation, and system tables. The complete skeem experience.
- **Data** — introspection and CRUD; schema is code-defined or fixed, so `define` is unsupported or partial. System features work if the backend can host `skeem_*` collections.
- **Content** — fixed schema, CRUD on known object types. System features need a sidecar store (see below).

## Tier 1 — highest leverage

These validate the adapter abstraction and hit the core audience hardest.

| # | Backend | Tier | Why | Fit notes |
|---|---------|------|-----|-----------|
| 1 | Supabase | Full | The default backend of the agent-builder crowd; named in the original spec | Postgres relations; data via PostgREST API; schema via management API or SQL channel; hosts system tables natively |
| 2 | PocketBase ✅ | Full | Single-binary SQLite backend beloved by indie hackers; the cheapest full-capability proof of the abstraction | **Shipped (`@skeems/pocketbase`).** Collections API maps almost 1:1 to `SkemAdapter` including schema mutation; trivial Docker fixture. m2m record `link`/`unlink` works via the relation array (adapter `link`/`unlink` capability); m2m *schema* creation via `define` is unsupported |
| 3 | Strapi ✅ | Data | Largest open-source headless CMS community | **Shipped (`@skeems/strapi`, data tier).** Strapi v5 REST for CRUD (documentId-keyed, flat responses); introspection via the admin content-type-builder API (admin JWT — API tokens are 403'd there). No schema mutation: content types are code-defined, so `define`/`init` are unsupported by design |
| 4 | NocoDB ✅ | Full | Self-hosted Airtable-on-any-database; ops and internal-tools crowd | **Shipped (`@skeems/nocodb`).** Meta API covers tables, fields, and links; addresses everything by id (adapter keeps a name↔id catalog). m2o + m2m fully: record `link`/`unlink` use NocoDB's nested-link endpoint (adapter `link`/`unlink` capability) since the native `mm` junction is hidden |
| 5 | Airtable | Full | The automation crowd's default datastore; enormous reach | Records API plus Meta API for schema; linked records map to relations; hosted-only, so smoke needs a sandbox base |
| 6 | Appwrite | Full | Large open-source Firebase-alternative community | Databases/attributes/relationships all manageable via API; Docker fixture available |

## Tier 2 — high-demand content and data platforms

| # | Backend | Tier | Why | Fit notes |
|---|---------|------|-----|-----------|
| 7 | Notion | Data | Probably the single most-requested agent datastore anywhere | Databases as collections, relation properties exist; rate limits and pagination quirks; system tables can be plain databases |
| 8 | WordPress | Content→Data | Colossal install base; "agents managing WP content" is a real daily need | REST API solid for CRUD; schema is semi-fixed (custom post types in code, fields via ACF/Pods) — capability-flag it |
| 9 | Baserow | Full | The other open-source Airtable alternative; clean REST API including schema | Docker fixture easy |
| 10 | PostgREST | Data | Thin, standard, named in the spec; reaches every plain-Postgres self-hoster | Introspection via OpenAPI output; `define` needs a SQL side-channel — decide whether that stays out of scope |
| 11 | Hasura | Data→Full | GraphQL-over-Postgres; internal-tools and API-platform crowd | Metadata API tracks tables; DDL via run_sql; relations are first-class |
| 12 | Payload | Data | Fast-growing TypeScript-first CMS | Schema defined in code → introspect + CRUD only; no `define` |
| 13 | Contentful | Full | The agency/enterprise hosted CMS | Content-type management API is complete; hosted-only testing |
| 14 | Sanity | Data | Big developer mindshare | Strong data API; schema lives in code → data tier |
| 15 | Ghost | Content | Huge publisher base; clean "agents run your blog" story | Fixed schema via Admin API; system features need the sidecar |

## Tier 3 — commerce and business objects

Agents doing operations (orders, customers, deals) rather than content.

| # | Backend | Tier | Why | Fit notes |
|---|---------|------|-----|-----------|
| 16 | Shopify | Data | The agent-commerce wave is real; metaobjects/metafields give dynamic-ish schema | Admin GraphQL API; bigger effort; hosted sandbox for tests |
| 17 | Medusa | Data | Open-source commerce; same self-hosted Node crowd as Directus | Admin REST API; Docker fixture possible |
| 18 | WooCommerce | Content | Rides the WordPress adapter for near-free incremental reach | REST API for commerce objects |
| 19 | HubSpot | Data→Full | Custom objects + associations are a genuine schema API; RevOps automation crowd | Hosted sandbox testing |
| 20 | Attio | Data→Full | API-first modern CRM with custom objects; startup audience | Hosted |
| 21 | Twenty | Data→Full | Open-source CRM; exactly the Directus-adjacent self-hosted audience | GraphQL/REST; custom objects; Docker fixture |
| 22 | Frappe / ERPNext | Full | DocTypes are fully dynamic via API; self-hosted ERP ops is an underserved agent niche | Heavy fixture but Docker-able |

## Tier 4 — local, databases, and emerging

| # | Backend | Tier | Why | Fit notes |
|---|---------|------|-----|-----------|
| 23 | SQLite (local file) | Full | Zero-infrastructure onboarding, demos, and tests; pure personal-agent workflows | Tension with the spec's "not a database client" stance — adopt deliberately or skip deliberately |
| 24 | Grist | Full | Open-source spreadsheet-database with a real schema API; small but perfectly aligned community | Docker fixture |
| 25 | Teable | Full | Newer open-source Airtable alternative, API-first and growing | Docker fixture |
| 26 | Convex | Data | TypeScript reactive backend with an agent-curious user base | Schema in code → data tier |
| 27 | Firebase / Firestore | Data | Enormous reach | Weakest fit in the list: schemaless (introspection must be inferred), relations are manual; demand carries it |
| 28 | SurrealDB | Data→Full | First-class relations over HTTP; enthusiast energy | Schema-full mode enables `define` |
| 29 | Hygraph | Full | GraphQL-native hosted CMS with a management API | Hosted |
| 30 | Storyblok | Data | Component-based hosted CMS; agency audience | Management API for components |

**Considered and cut:** Salesforce (audience and sales motion mismatch), Coda/SeaTable (covered by the Airtable-class picks), Keystone/Webiny/Cockpit (small communities), Odoo (huge but heavyweight XML-RPC integration), raw Postgres/MySQL drivers (Supabase/PostgREST/Hasura cover the need while staying API-level per the spec), Prisma (an ORM — explicitly off-thesis), Xata, Nhost.

## Schemaless targets: introspection strategy

Schemaless stores (Firestore today; MongoDB/DynamoDB if the "not a database client" stance is ever revisited) have no schema API, so `introspect()` must be earned. Three layers, in trust order:

1. **Declared.** `skeem define` writes the schema into the store itself as a `skeem_schema` system document; introspection reads it back exactly, and writes are validated against it. For schemaless backends skeem becomes the schema discipline layer the store lacks — a stronger pitch there than anywhere else. Small effort; ships with the first schemaless adapter.
2. **Fingerprint.** Convention packs that recognize known data producers and map them to schema templates, including relations (the thing sampling can't recover reliably). Real-world fingerprints are abundant because schemaless data is produced by convention-generating machines: Mongoose stamps `__v` and timestamp fields; ElectroDB writes `__edb_e__`/`__edb_v__` into every DynamoDB item; OneTable writes `_type`; Firebase Extensions document the exact collections they create (e.g. the Stripe extension's `customers/{uid}/checkout_sessions`); starter templates and tutorials concentrate Firestore apps around `users`-keyed-by-auth-uid shapes. The convention survey is scriptable, not anthropological: harvest `firestore.rules` files in public repos, DynamoDB key design from IaC (CDK/Terraform/serverless.yml), extension docs, and ODM source defaults.
3. **Sampled.** Statistical inference over N documents per collection: field presence rates, type unions, id-shaped fields, `*_id`/`*Id` relation candidates. Prior art exists (MongoDB Compass, the `mongodb-schema` package) — the fingerprint layer is the novel part, not this one.

**The magnifying effect:** as more schemas are designed by LLMs trained on the same tutorials, real-world schemas converge on the modal shapes — so a convention library appreciates over time instead of rotting. (Agents also make bespoke schemas cheap, widening the tail, but the value is in the head of the distribution.) And skeem can be a convention *producer* rather than a chaser: declared manifests written by agents using skeem become the convention.

**Contract rule:** inferred schema elements must carry `confidence` and `evidence` (declared / fingerprint / sampled) as additive fields in the envelope — never present a guess as a fact to an agent.

**Sequencing:** record the strategy now; build the declared layer with the first schemaless adapter; treat the fingerprint survey as research-scale work scheduled only when a schemaless target gets promoted out of Tier 4. Convention packs are a natural payload for the deferred extension registry (slice 18), which gives that slice a concrete consumer when its day comes.

## Prerequisites before adapter #2

1. **Sever the Directus seam.** Core currently hard-codes the Directus adapter import and duck-types its errors; `load-config.ts` already resolves `config.adapter` and the runtime ignores it. Adapter registry/dynamic import plus adapter-owned error normalization is the gateway slice for everything on this page.
2. **Formalize the capability matrix.** The optional methods on `SkemAdapter` already encode it; make capabilities declarable and reportable so Data/Content-tier adapters fail predictably instead of confusingly.
3. **Decide the system-table sidecar question once.** Backends that cannot create `skeem_*` collections (Ghost, Shopify, WooCommerce) need a local sidecar store for claims/provenance/idempotency — or those features stay unsupported there. Prefer backends that host system tables natively until the sidecar is designed.
4. **Per-adapter smoke fixtures.** Replicate the Directus Docker pattern for every self-hostable adapter; hosted backends (Airtable, Notion, Shopify, HubSpot) need sandbox accounts or recorded fixtures and therefore cost more to maintain — weight that in sequencing.

## Suggested first three

1. **PocketBase** — cheapest full-capability proof that the abstraction holds; instant local demo story.
2. **Supabase** — largest audience overlap with agent builders; validates a Postgres-backed adapter.
3. **Strapi or NocoDB** — Strapi for community size, NocoDB for the cleaner schema API; pick based on appetite for Strapi's dev-mode `define` constraint.
