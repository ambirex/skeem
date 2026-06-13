// Declarative specs for the recorded site demos. Each scenario's commands are
// run for real by capture.mjs against either a live reference API (backend:
// null, run from a clean temp dir) or the local Directus fixture (backend:
// "directus", run from the demo workspace). The captured stdout becomes the
// JSON the terminal widget replays — see site/README.md.
//
// Per step:
//   display     what the visitor sees and copies (real, runnable command)
//   run         argv passed to the skeem binary (display minus the binary name)
//   pipe        optional jq filter; when set, display includes `| jq '<pipe>'`
//                 and the captured output is the piped result (keeps huge
//                 reference payloads tight while staying honest)
//   stdin       optional stdin (exec plans)
//   expectExit  asserted exit code (default 0; the claims clash expects 1)
//   foldAfter   display hint: collapse output after N lines
//   highlight   substrings the widget marks as the payoff
//   comment     dimmed line shown above the prompt
//   note        annotation shown under the step

export const scenarios = [
  {
    id: "zero-config-lookup",
    title: "No backend. No key. One command.",
    tagline: "Public reference data, straight from the CLI.",
    backend: null,
    liveApis: ["wikidata"],
    steps: [
      {
        comment: "# look up Douglas Adams — no install, no backend, no API key",
        display: "npx skeem get items Q42 --adapter wikidata --json",
        run: ["get", "items", "Q42", "--adapter", "wikidata", "--json"],
        pipe:
          "{label: .data.label, description: .data.description, imdb: .data.externalIds.imdb, musicbrainz: .data.externalIds.musicbrainz_artist, openlibrary: .data.externalIds.openlibrary, viaf: .data.externalIds.viaf}",
        highlight: ['"Douglas Adams"'],
        note: "One Q-id, and identifiers for IMDb, MusicBrainz, Open Library, VIAF… all ride along — every value is an array.",
      },
      {
        comment: "# go the other way: which item owns this IMDb id?",
        display: 'npx skeem find items --where imdb=tt0133093 --adapter wikidata --json',
        run: ["find", "items", "--where", "imdb=tt0133093", "--adapter", "wikidata", "--json"],
        pipe: ".data[0] | {id, label}",
        highlight: ['"The Matrix"', '"Q83495"'],
        note: "Reverse lookup by external id — the bridge runs both directions.",
      },
    ],
  },

  {
    id: "enrich-create",
    title: "Look it up, don't make it up.",
    tagline: "Agents fetch facts instead of recalling them.",
    backend: "directus",
    liveApis: ["wikidata"],
    steps: [
      {
        comment: "# what does the movies collection look like?",
        display: "skeem describe movies --json",
        run: ["describe", "movies", "--json"],
        pipe: "{collection: .data.collection, fields: [.data.fields[].name]}",
        note: "Discover first, so the write targets real fields.",
      },
      {
        comment: "# create from a reference record — facts come from WikiData, not from a guess",
        display:
          'skeem create movies --enrich wikidata:items:Q83495 \\\n  --map label=title --map description=overview --map externalIds.imdb=imdb_id --json',
        run: [
          "create", "movies",
          "--enrich", "wikidata:items:Q83495",
          "--map", "label=title",
          "--map", "description=overview",
          "--map", "externalIds.imdb=imdb_id",
          "--json",
        ],
        highlight: ['"enrichedFrom"', '"The Matrix"', '"imdb_id"'],
        note: "enrichedFrom / enrichedFields make the provenance auditable. Your explicit fields would always win.",
      },
    ],
  },

  {
    id: "reading-log",
    title: "A reading log from bare ISBNs.",
    tagline: "No-auth reference lookups, safe to re-run.",
    backend: "directus",
    liveApis: ["openlibrary"],
    steps: [
      {
        comment: "# resolve an ISBN against Open Library (no auth)",
        display: 'skeem find editions --where isbn=9780345391803 --adapter openlibrary --json',
        run: ["find", "editions", "--where", "isbn=9780345391803", "--adapter", "openlibrary", "--json"],
        pipe: ".data[0] | {id, title}",
        note: "The find-form lookup; works for a barcode scanner in a shell loop.",
      },
      {
        comment: "# upsert it into your catalog, enriched from Open Library, with an idempotency key",
        display:
          'skeem upsert books --match isbn_13=9780345391803 \\\n  --enrich "openlibrary:editions?isbn=9780345391803" --idempotency-key isbn-9780345391803 --json',
        run: [
          "upsert", "books",
          "--match", "isbn_13=9780345391803",
          "--enrich", "openlibrary:editions?isbn=9780345391803",
          "--idempotency-key", "isbn-9780345391803",
          "--json",
        ],
        highlight: ['"action"', '"created"'],
        note: "First run creates the row.",
      },
      {
        comment: "# run the exact same command again — idempotency replays the stored result",
        display:
          'skeem upsert books --match isbn_13=9780345391803 \\\n  --enrich "openlibrary:editions?isbn=9780345391803" --idempotency-key isbn-9780345391803 --json',
        run: [
          "upsert", "books",
          "--match", "isbn_13=9780345391803",
          "--enrich", "openlibrary:editions?isbn=9780345391803",
          "--idempotency-key", "isbn-9780345391803",
          "--json",
        ],
        pipe: "{ok, action, id: .data.id}",
        highlight: ['"created"'],
        note: 'action stays "created" (not "updated") — same key + input returns the stored result, not a second write.',
      },
      {
        comment: "# and there's still just one book — the re-run created no duplicate",
        display: "skeem find books --json",
        run: ["find", "books", "--json"],
        pipe: "{count, titles: [.data[].title]}",
        highlight: ['"count": 1'],
        note: "Point this at a CSV of ISBNs and re-run the whole loop freely.",
      },
    ],
  },

  {
    id: "self-snapshot",
    title: "Order lines that don't track the source.",
    tagline: "Your own backend, used as a source.",
    backend: "directus",
    liveApis: [],
    steps: [
      {
        comment: "# a product in your catalog",
        display: "skeem find products --where sku=WIDGET-9 --json",
        run: ["find", "products", "--where", "sku=WIDGET-9", "--json"],
        pipe: ".data[0] | {id, sku, name, price}",
        note: "Price today: 19.99.",
      },
      {
        comment: "# snapshot it onto an order line via a self: source — copy name + price",
        display:
          'skeem create order_lines --order_ref INV-1042 --qty 2 \\\n  --enrich "self:products?sku=WIDGET-9" --map name=product_name --map price=unit_price --json',
        run: [
          "create", "order_lines",
          "--order_ref", "INV-1042",
          "--qty", "2",
          "--enrich", "self:products?sku=WIDGET-9",
          "--map", "name=product_name",
          "--map", "price=unit_price",
          "--json",
        ],
        highlight: ['"unit_price"', '19.99'],
        note: "self: is just a source pointing back at your own backend.",
      },
      {
        comment: "# the product price changes later…",
        display: "skeem update products 1 --price 24.99 --json",
        run: ["update", "products", "1", "--price", "24.99", "--json"],
        pipe: ".data | {id, price}",
        note: "",
      },
      {
        comment: "# …but the order line kept its point-in-time copy",
        display: "skeem get order_lines 1 --json",
        run: ["get", "order_lines", "1", "--json"],
        pipe: ".data | {order_ref, product_name, unit_price}",
        highlight: ["19.99"],
        note: "Invoices and quotes should NOT track the source — deliberate denormalization, with provenance recording where it came from.",
      },
    ],
  },

  {
    id: "claims",
    title: "Two agents, one record.",
    tagline: "Coordination primitives, built in.",
    backend: "directus",
    liveApis: [],
    steps: [
      {
        comment: "# agent-a leases the record before working on it",
        display: 'skeem claim movies:1 --lease 15m --purpose "enriching metadata" --actor agent-a --json',
        run: ["claim", "movies:1", "--lease", "15m", "--purpose", "enriching metadata", "--actor", "agent-a", "--json"],
        highlight: ['"ok": true'],
        note: "A lease, not a lock — it expires on its own.",
      },
      {
        comment: "# agent-b tries to claim the same record",
        display: "skeem claim movies:1 --lease 5m --actor agent-b --json",
        run: ["claim", "movies:1", "--lease", "5m", "--actor", "agent-b", "--json"],
        expectExit: 1,
        highlight: ['"ok": false', '"code"'],
        note: "It fails on purpose — the typed error envelope IS the coordination signal.",
      },
      {
        comment: "# agent-a leaves a breadcrumb, then releases",
        display: 'skeem annotate movies:1 --key review --value \'"needs-citation"\' --actor agent-a --json',
        run: ["annotate", "movies:1", "--key", "review", "--value", '"needs-citation"', "--actor", "agent-a", "--json"],
        pipe: "{ok, operation, data: {key: .data.key, value: .data.value}}",
        note: "Annotations + provenance leave a trail the next agent can read.",
      },
      {
        comment: "",
        display: "skeem release movies:1 --actor agent-a --json",
        run: ["release", "movies:1", "--actor", "agent-a", "--json"],
        highlight: ['"ok": true'],
        note: "",
      },
    ],
  },

  {
    id: "exec-dag",
    title: "A dependent graph in one call.",
    tagline: "Multi-step plans with reference resolution.",
    backend: "directus",
    liveApis: [],
    steps: [
      {
        comment: "# a plan: upsert a company, then create a person linked to it",
        display: "cat plan.json",
        catFile: "plan.json",
        note: "$company.id is resolved from the first step's result.",
      },
      {
        comment: "# run the whole plan in one call",
        display: "skeem exec --json < plan.json",
        run: ["exec", "--json"],
        stdinFile: "plan.json",
        highlight: ['"compound', '"company_id"'],
        note: "Operations run in order; $ref.field threads results between steps.",
      },
      {
        comment: "# read the person back with the company expanded",
        display: "skeem get people 1 --expand company_id --json",
        run: ["get", "people", "1", "--expand", "company_id", "--json"],
        pipe: ".data | {id, name, company_id}",
        note: "",
      },
    ],
  },

  {
    id: "pivot-bridge",
    title: "One id unlocks the whole graph.",
    tagline: "The same entity across three datasets.",
    backend: null,
    liveApis: ["musicbrainz", "openlibrary"],
    steps: [
      {
        comment: "# the MusicBrainz artist for Douglas Adams",
        display:
          "npx skeem get artists e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4 --adapter musicbrainz --json",
        run: ["get", "artists", "e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4", "--adapter", "musicbrainz", "--json"],
        pipe: "{id: .data.id, name: .data.name, wikidata: .data.externalIds.wikidata}",
        highlight: ['"Q42"'],
        note: "A different dataset, pointing back at the same WikiData hub.",
      },
      {
        comment: "# and the Open Library author",
        display: "npx skeem get authors OL272947A --adapter openlibrary --json",
        run: ["get", "authors", "OL272947A", "--adapter", "openlibrary", "--json"],
        pipe: "{id: .data.id, name: .data.name, wikidata: .data.externalIds.wikidata}",
        highlight: ['"Q42"'],
        note: "Three datasets, one shared identity — pivot freely between them.",
      },
    ],
  },
];
