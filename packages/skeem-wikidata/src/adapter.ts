import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { simplifyClaims } from "./claims.js";
import { WikiDataClient } from "./client.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FindOptions,
  GetOptions,
  Schema,
  WbGetEntitiesResponse,
  WbSearchEntitiesResponse,
  WikibaseEntity,
} from "./types.js";

const READ_ONLY_MESSAGE = "The WikiData adapter is read-only — it supports `get`, `find`, `describe`, `discover`, and `ls` only.";

/**
 * Read-only adapter over WikiData (and any Wikibase instance) via the MediaWiki
 * Action API. WikiData is a knowledge graph, not a table store, so it maps to two
 * synthetic collections — `items` (Q-ids) and `properties` (P-ids) — each keyed
 * by `id` with stable `label`/`description`/`aliases` fields. `get` returns an
 * entity's simplified claims as dynamic data; `find` searches by label. All
 * writes and schema mutation are unsupported.
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
        props: "labels|descriptions|aliases|claims|datatype",
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

      if (filter.id !== undefined && filter.id !== null) {
        const entityId = String(filter.id);
        const response = await client.get<WbGetEntitiesResponse>({
          action: "wbgetentities",
          ids: entityId,
          languages: language,
          props: "labels|descriptions",
        });
        const entity = response.entities?.[entityId];
        return entity && entity.missing === undefined ? [toSummary(entity, language)] : [];
      }

      const search = filter.label ?? filter.search;
      if (search === undefined || search === null) {
        throw new AdapterError(
          `WikiData find supports --where label=<text> or --where id=<id>.`,
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
  return {
    id: entity.id,
    label: term(entity.labels, lang),
    description: term(entity.descriptions, lang),
    aliases: (entity.aliases?.[lang] ?? []).map((alias) => alias.value),
    ...(entity.datatype ? { datatype: entity.datatype } : {}),
    claims: simplifyClaims(entity.claims),
  };
}
