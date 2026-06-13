import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { EXTERNAL_ID_KEYS, partitionClaims } from "./claims.js";
import { WikiDataClient } from "./client.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FindOptions,
  GetOptions,
  MediaWikiSearchResponse,
  Schema,
  WbGetEntitiesResponse,
  WbSearchEntitiesResponse,
  WikibaseEntity,
} from "./types.js";

const READ_ONLY_MESSAGE = "The WikiData adapter is read-only — it supports `get`, `find`, `describe`, `discover`, and `ls` only.";
const REVERSE_LOOKUP_MAX = 50; // wbgetentities hydration batch limit

/**
 * Read-only adapter over WikiData (and any Wikibase instance) via the MediaWiki
 * Action API. WikiData is a knowledge graph, not a table store, so it maps to two
 * synthetic collections — `items` (Q-ids) and `properties` (P-ids) — each keyed
 * by `id` with stable `label`/`description`/`aliases` fields. `get` returns an
 * entity's ordinary statements under `claims` and its external identifiers under
 * `externalIds` (conventional keys per docs/reference/external-ids.md); `find`
 * searches by label, or reverse-looks-up items by an external id
 * (`--where imdb=nm0010930`, `--where P345=...`). All writes are unsupported.
 */
export function createWikiDataAdapter(): SkemAdapter {
  const client = new WikiDataClient();
  let language = "en";

  return {
    name: "wikidata",

    async connect(config: AdapterConfig) {
      client.connect(config);
      if (typeof config["language"] === "string" && config["language"].length > 0) {
        language = config["language"];
      }
    },

    async introspect(): Promise<Schema> {
      const collections = new Map<string, Collection>();
      for (const name of ["items", "properties"]) {
        collections.set(name, {
          name,
          primaryKey: "id",
          fields: new Map<string, Field>([
            ["label", { name: "label", type: "string", required: false, unique: false }],
            ["description", { name: "description", type: "string", required: false, unique: false }],
            ["aliases", { name: "aliases", type: "csv", required: false, unique: false }],
            ["externalIds", { name: "externalIds", type: "json", required: false, unique: false }],
          ]),
          relations: [],
          uniqueConstraints: [],
        });
      }
      return { collections };
    },

    async get(collection: string, id: string | number, _options?: GetOptions): Promise<Record<string, unknown>> {
      resolveType(collection);
      const entityId = String(id);
      const response = await client.get<WbGetEntitiesResponse>({
        action: "wbgetentities",
        ids: entityId,
        languages: language,
        // WikiData migrated many entities' labels to the language-agnostic `mul`
        // code (2024); languagefallback lets `languages=en` still resolve them
        // (e.g. Q42 → "Douglas Adams"), matching what users see on the site.
        languagefallback: 1,
        props: "labels|descriptions|aliases|claims|datatype|sitelinks/urls",
      });
      const entity = response.entities?.[entityId];
      if (!entity || entity.missing !== undefined) {
        throw new AdapterError(`WikiData has no ${singular(collection)} "${entityId}".`, { kind: "not_found" });
      }
      return toFullRecord(entity, language);
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      const type = resolveType(collection);

      if (options?.sort) {
        throw new AdapterError("WikiData find does not support --sort.", { kind: "validation", field: "sort" });
      }

      const activeKeys = Object.keys(filter).filter((key) => filter[key] !== undefined && filter[key] !== null);
      const externalKeys = activeKeys.filter(
        (key) => key !== "id" && key !== "label" && key !== "search" && (key in EXTERNAL_ID_KEYS || /^P\d+$/.test(key)),
      );

      if (externalKeys.length > 1) {
        throw new AdapterError(
          `WikiData find supports at most one external-id filter (got: ${externalKeys.join(", ")}).`,
          { kind: "validation" },
        );
      }

      if (externalKeys.length === 1) {
        const key = externalKeys[0]!;
        if (activeKeys.length > 1) {
          throw new AdapterError(
            `An external-id filter cannot be combined with other filters (got: ${activeKeys.join(", ")}).`,
            { kind: "validation", field: key },
          );
        }
        if (type !== "item") {
          throw new AdapterError("External-id lookups are supported for items only.", { kind: "validation", field: key });
        }
        return findByExternalId(client, language, key, filter[key]!, options);
      }

      if (filter.id !== undefined && filter.id !== null) {
        if (options?.offset !== undefined) {
          throw new AdapterError("--offset is not supported with an id filter.", { kind: "validation", field: "offset" });
        }
        const entityId = String(filter.id);
        const response = await client.get<WbGetEntitiesResponse>({
          action: "wbgetentities",
          ids: entityId,
          languages: language,
          languagefallback: 1,
          props: "labels|descriptions",
        });
        const entity = response.entities?.[entityId];
        return entity && entity.missing === undefined ? [toSummary(entity, language)] : [];
      }

      const search = filter.label ?? filter.search;
      if (search === undefined || search === null) {
        throw new AdapterError(
          "WikiData find supports --where label=<text>, --where id=<id>, or one external-id filter (e.g. --where imdb=nm0010930, --where P345=...).",
          { kind: "validation", field: "label" },
        );
      }

      const response = await client.get<WbSearchEntitiesResponse>({
        action: "wbsearchentities",
        search: String(search),
        language,
        uselang: language,
        type,
        limit: options?.limit ?? 10,
        ...(options?.offset !== undefined ? { continue: options.offset } : {}),
      });
      return (response.search ?? []).map((entry) => ({
        id: entry.id,
        label: entry.label ?? null,
        description: entry.description ?? null,
      }));
    },

    async count(): Promise<number | null> {
      // WikiData has ~100M items; a meaningful count is neither cheap nor useful.
      return null;
    },

    async create(): Promise<Record<string, unknown>> {
      throw new AdapterError(READ_ONLY_MESSAGE, { kind: "unknown" });
    },

    async update(): Promise<Record<string, unknown>> {
      throw new AdapterError(READ_ONLY_MESSAGE, { kind: "unknown" });
    },

    async delete(): Promise<void> {
      throw new AdapterError(READ_ONLY_MESSAGE, { kind: "unknown" });
    },
  } satisfies SkemAdapter;
}

/**
 * Reverse lookup: find the items that carry a given external identifier, via
 * CirrusSearch's haswbstatement, then hydrate labels with one batched
 * wbgetentities call. haswbstatement matches exactly and case-sensitively.
 */
async function findByExternalId(
  client: WikiDataClient,
  language: string,
  key: string,
  rawValue: string | number | boolean,
  options?: FindOptions,
): Promise<Record<string, unknown>[]> {
  const limit = options?.limit ?? 10;
  if (limit > REVERSE_LOOKUP_MAX) {
    throw new AdapterError(
      `External-id lookups support --limit up to ${REVERSE_LOOKUP_MAX}.`,
      { kind: "validation", field: "limit" },
    );
  }

  const propertyId = EXTERNAL_ID_KEYS[key] ?? key;
  let value = String(rawValue).replace(/"/g, "");
  if (propertyId === "P345") {
    value = value.toLowerCase(); // IMDb ids are stored lowercase (tt…/nm…)
  }
  const clause = `${propertyId}=${value}`;
  const srsearch = /\s/.test(value) ? `haswbstatement:"${clause}"` : `haswbstatement:${clause}`;

  const searchResponse = await client.get<MediaWikiSearchResponse>({
    action: "query",
    list: "search",
    srsearch,
    srnamespace: 0,
    srlimit: limit,
    ...(options?.offset !== undefined ? { sroffset: options.offset } : {}),
  });
  const titles = (searchResponse.query?.search ?? []).map((entry) => entry.title);
  if (titles.length === 0) {
    return [];
  }

  const entities = await client.get<WbGetEntitiesResponse>({
    action: "wbgetentities",
    ids: titles.join("|"),
    languages: language,
    languagefallback: 1,
    props: "labels|descriptions",
  });
  return titles
    .map((title) => entities.entities?.[title])
    .filter((entity): entity is WikibaseEntity => Boolean(entity) && entity!.missing === undefined)
    .map((entity) => toSummary(entity, language));
}

function resolveType(collection: string): "item" | "property" {
  if (collection === "items") return "item";
  if (collection === "properties") return "property";
  throw new AdapterError(
    `WikiData adapter has no collection "${collection}". Use "items" or "properties".`,
    { kind: "not_found", collectionMissing: true },
  );
}

function singular(collection: string): string {
  return collection === "properties" ? "property" : "item";
}

function term(map: Record<string, { value: string }> | undefined, lang: string): string | null {
  return map?.[lang]?.value ?? null;
}

function toSummary(entity: WikibaseEntity, lang: string): Record<string, unknown> {
  return {
    id: entity.id,
    label: term(entity.labels, lang),
    description: term(entity.descriptions, lang),
  };
}

function toFullRecord(entity: WikibaseEntity, lang: string): Record<string, unknown> {
  const partitioned = partitionClaims(entity.claims);
  const wikipediaUrl = entity.sitelinks?.[`${lang}wiki`]?.url;
  return {
    id: entity.id,
    label: term(entity.labels, lang),
    description: term(entity.descriptions, lang),
    aliases: (entity.aliases?.[lang] ?? []).map((alias) => alias.value),
    ...(entity.datatype ? { datatype: entity.datatype } : {}),
    claims: partitioned.claims,
    externalIds: {
      ...partitioned.externalIds,
      ...(wikipediaUrl ? { wikipedia: [wikipediaUrl] } : {}),
    },
  };
}
