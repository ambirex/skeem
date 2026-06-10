import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { TmdbClient } from "./client.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  Schema,
  TmdbEntity,
  TmdbExternalIds,
  TmdbFindResponse,
  TmdbSearchResponse,
} from "./types.js";

const READ_ONLY_MESSAGE = "The TMDB adapter is read-only — it supports `get`, `find`, `describe`, `discover`, and `ls` only.";
const SEARCH_PAGE_SIZE = 20;

interface CollectionSpec {
  /** API path segment — note "person" is singular. */
  path: "movie" | "tv" | "person";
  /** Bucket key in /find responses. */
  findKey: keyof TmdbFindResponse;
  nameField: "title" | "name";
  fields: Array<[string, FieldType]>;
}

const COLLECTIONS: Record<string, CollectionSpec> = {
  movies: {
    path: "movie",
    findKey: "movie_results",
    nameField: "title",
    fields: [["title", "string"], ["release_date", "string"], ["overview", "text"], ["vote_average", "float"]],
  },
  tv: {
    path: "tv",
    findKey: "tv_results",
    nameField: "name",
    fields: [["name", "string"], ["first_air_date", "string"], ["overview", "text"], ["vote_average", "float"]],
  },
  people: {
    path: "person",
    findKey: "person_results",
    nameField: "name",
    fields: [["name", "string"], ["birthday", "string"], ["known_for_department", "string"], ["biography", "text"]],
  },
};

/**
 * Read-only adapter over the TMDB v3 API: `movies`, `tv`, `people`, keyed by
 * the numeric TMDB id. `get` appends external_ids and surfaces them in the
 * shared externalIds vocabulary (imdb, wikidata, tvdb + social handles);
 * `find` searches by title/name, or reverse-resolves an IMDb/Wikidata id via
 * TMDB's /find endpoint. Requires an API token (the only read-tier adapter
 * with auth). This product uses the TMDB API but is not endorsed or certified
 * by TMDB.
 */
export function createTmdbAdapter(): SkemAdapter {
  const client = new TmdbClient();
  let language: string | undefined;

  return {
    name: "tmdb",

    async connect(config: AdapterConfig) {
      client.connect(config);
      language = typeof config["language"] === "string" && config["language"].length > 0
        ? config["language"]
        : undefined;
    },

    async introspect(): Promise<Schema> {
      const collections = new Map<string, Collection>();
      for (const [name, spec] of Object.entries(COLLECTIONS)) {
        const fields = new Map<string, Field>([
          ["id", { name: "id", type: "integer", required: true, unique: true }],
        ]);
        for (const [fieldName, type] of spec.fields) {
          fields.set(fieldName, {
            name: fieldName,
            type,
            required: fieldName === spec.nameField,
            unique: false,
          });
        }
        fields.set("externalIds", { name: "externalIds", type: "json", required: false, unique: false });
        collections.set(name, { name, primaryKey: "id", fields, relations: [], uniqueConstraints: [] });
      }
      return { collections };
    },

    async get(collection: string, id: string | number, _options?: GetOptions): Promise<Record<string, unknown>> {
      const spec = resolveSpec(collection);
      const entity = await client.get<TmdbEntity>(`/${spec.path}/${encodeURIComponent(String(id))}`, {
        append_to_response: "external_ids",
        ...(language ? { language } : {}),
      });
      return toRecord(spec, entity);
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      const spec = resolveSpec(collection);

      if (options?.sort) {
        throw new AdapterError("TMDB find does not support --sort.", { kind: "validation", field: "sort" });
      }
      if (options?.offset !== undefined) {
        throw new AdapterError(
          "TMDB find does not support --offset (the API is page-based).",
          { kind: "validation", field: "offset" },
        );
      }

      const limit = options?.limit ?? 10;
      if (limit > SEARCH_PAGE_SIZE) {
        throw new AdapterError(
          `TMDB find supports --limit up to ${SEARCH_PAGE_SIZE} (one API page).`,
          { kind: "validation", field: "limit" },
        );
      }

      if (filter.id !== undefined && filter.id !== null) {
        const record = await this.get(collection, String(filter.id)).catch((error: unknown) => {
          if (error instanceof AdapterError && error.kind === "not_found") return undefined;
          throw error;
        });
        return record ? [record] : [];
      }

      // Reverse lookup by external id via /find.
      const externalSource = filter.imdb !== undefined && filter.imdb !== null
        ? { source: "imdb_id", value: String(filter.imdb).toLowerCase() }
        : filter.wikidata !== undefined && filter.wikidata !== null
          ? { source: "wikidata_id", value: String(filter.wikidata).toUpperCase() }
          : undefined;
      if (externalSource) {
        const response = await client.get<TmdbFindResponse>(
          `/find/${encodeURIComponent(externalSource.value)}`,
          { external_source: externalSource.source, ...(language ? { language } : {}) },
        );
        return (response[spec.findKey] ?? []).slice(0, limit).map((entity) => toSummary(spec, entity));
      }

      const query = filter[spec.nameField] ?? filter.q ?? filter.search;
      if (query === undefined || query === null) {
        throw new AdapterError(
          `TMDB find supports --where ${spec.nameField}=<text> (or q=/search=), --where imdb=<id>, --where wikidata=<Q-id>, and --where id=<tmdb id>.`,
          { kind: "validation", field: spec.nameField },
        );
      }

      const response = await client.get<TmdbSearchResponse>(`/search/${spec.path}`, {
        query: String(query),
        page: 1,
        ...(language ? { language } : {}),
      });
      return (response.results ?? []).slice(0, limit).map((entity) => toSummary(spec, entity));
    },

    async count(): Promise<number | null> {
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

function resolveSpec(collection: string): CollectionSpec {
  const spec = COLLECTIONS[collection];
  if (!spec) {
    throw new AdapterError(
      `TMDB adapter has no collection "${collection}". Use: movies, tv, people.`,
      { kind: "not_found", collectionMissing: true },
    );
  }
  return spec;
}

function toRecord(spec: CollectionSpec, entity: TmdbEntity): Record<string, unknown> {
  const record: Record<string, unknown> = { id: entity.id };
  for (const [fieldName] of spec.fields) {
    const value = (entity as unknown as Record<string, unknown>)[fieldName];
    record[fieldName] = value === "" || value === undefined ? null : value;
  }
  record.externalIds = extractExternalIds(entity);
  return record;
}

function toSummary(spec: CollectionSpec, entity: TmdbEntity): Record<string, unknown> {
  return {
    id: entity.id,
    [spec.nameField]: entity[spec.nameField] ?? null,
    ...(entity.release_date ? { release_date: entity.release_date } : {}),
    ...(entity.first_air_date ? { first_air_date: entity.first_air_date } : {}),
    ...(entity.known_for_department ? { known_for_department: entity.known_for_department } : {}),
  };
}

function extractExternalIds(entity: TmdbEntity): Record<string, string[]> {
  const ids: TmdbExternalIds = entity.external_ids ?? {};
  const externalIds: Record<string, string[]> = {};
  const add = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).length > 0) {
      externalIds[key] = [String(value)];
    }
  };

  add("imdb", ids.imdb_id ?? entity.imdb_id);
  add("wikidata", ids.wikidata_id);
  add("tvdb", ids.tvdb_id);
  add("facebook", ids.facebook_id);
  add("instagram", ids.instagram_id);
  add("twitter", ids.twitter_id);
  return externalIds;
}
