import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { MusicBrainzClient } from "./client.js";
import { extractLinkRelations } from "./relations.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  MbEntity,
  MbSearchResponse,
  Schema,
} from "./types.js";

const READ_ONLY_MESSAGE = "The MusicBrainz adapter is read-only — it supports `get`, `find`, `describe`, `discover`, and `ls` only.";

interface CollectionSpec {
  /** WS/2 path segment, e.g. "release-group". */
  path: string;
  /** Key of the entity array in search responses. */
  listKey: keyof MbSearchResponse;
  /** The human-name field on records ("name" or "title"). */
  nameField: "name" | "title";
  fields: Array<[string, FieldType, { required?: boolean }?]>;
}

const COLLECTIONS: Record<string, CollectionSpec> = {
  artists: {
    path: "artist",
    listKey: "artists",
    nameField: "name",
    fields: [["name", "string", { required: true }], ["sort_name", "string"], ["type", "string"], ["country", "string"], ["disambiguation", "string"]],
  },
  release_groups: {
    path: "release-group",
    listKey: "release-groups",
    nameField: "title",
    // MusicBrainz dates are partial ("1991" / "1991-09"), so they stay strings.
    fields: [["title", "string", { required: true }], ["type", "string"], ["first_release_date", "string"], ["disambiguation", "string"]],
  },
  releases: {
    path: "release",
    listKey: "releases",
    nameField: "title",
    fields: [["title", "string", { required: true }], ["status", "string"], ["date", "string"], ["country", "string"], ["barcode", "string"], ["disambiguation", "string"]],
  },
  recordings: {
    path: "recording",
    listKey: "recordings",
    nameField: "title",
    fields: [["title", "string", { required: true }], ["length", "integer"], ["disambiguation", "string"]],
  },
  works: {
    path: "work",
    listKey: "works",
    nameField: "title",
    fields: [["title", "string", { required: true }], ["type", "string"], ["disambiguation", "string"]],
  },
  labels: {
    path: "label",
    listKey: "labels",
    nameField: "name",
    fields: [["name", "string", { required: true }], ["type", "string"], ["country", "string"], ["label_code", "integer"], ["disambiguation", "string"]],
  },
};

/**
 * Read-only adapter over the MusicBrainz WS/2 API. Collections map to the six
 * core entity types, keyed by MBID. `get` includes URL relationships, normalized
 * into the shared externalIds vocabulary (wikidata/imdb/viaf/isni + URL-valued
 * keys); un-normalized relation types ride along under `links`. `find` searches
 * by name/title (Lucene phrase). No reverse external-id search — pivot in via
 * the Wikidata hub (P434 etc.).
 */
export function createMusicBrainzAdapter(): SkemAdapter {
  const client = new MusicBrainzClient();

  return {
    name: "musicbrainz",

    async connect(config: AdapterConfig) {
      client.connect(config);
    },

    async introspect(): Promise<Schema> {
      const collections = new Map<string, Collection>();
      for (const [name, spec] of Object.entries(COLLECTIONS)) {
        const fields = new Map<string, Field>([
          ["id", { name: "id", type: "uuid", required: true, unique: true }],
        ]);
        for (const [fieldName, type, opts] of spec.fields) {
          fields.set(fieldName, { name: fieldName, type, required: opts?.required === true, unique: false });
        }
        fields.set("externalIds", { name: "externalIds", type: "json", required: false, unique: false });
        collections.set(name, { name, primaryKey: "id", fields, relations: [], uniqueConstraints: [] });
      }
      return { collections };
    },

    async get(collection: string, id: string | number, _options?: GetOptions): Promise<Record<string, unknown>> {
      const spec = resolveSpec(collection);
      const entity = await client.get<MbEntity>(`/ws/2/${spec.path}/${encodeURIComponent(String(id))}`, {
        inc: "url-rels",
      });
      return toRecord(spec, entity, { includeLinks: true });
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      const spec = resolveSpec(collection);

      if (options?.sort) {
        throw new AdapterError("MusicBrainz find does not support --sort.", { kind: "validation", field: "sort" });
      }

      if (filter.id !== undefined && filter.id !== null) {
        const entity = await client.get<MbEntity>(`/ws/2/${spec.path}/${encodeURIComponent(String(filter.id))}`)
          .catch((error: unknown) => {
            if (error instanceof AdapterError && error.kind === "not_found") return undefined;
            throw error;
          });
        return entity ? [toSummary(spec, entity)] : [];
      }

      const query = filter.q ?? filter.search ?? filter.name ?? filter.title;
      if (query === undefined || query === null) {
        throw new AdapterError(
          `MusicBrainz find supports --where ${spec.nameField}=<text> (or q=/search=) and --where id=<mbid>.`,
          { kind: "validation", field: spec.nameField },
        );
      }

      // Quote the value as a Lucene phrase; bare parens/colons would 400.
      const phrase = `"${String(query).replace(/"/g, '\\"')}"`;
      const response = await client.get<MbSearchResponse>(`/ws/2/${spec.path}`, {
        query: phrase,
        limit: options?.limit ?? 10,
        ...(options?.offset !== undefined ? { offset: options.offset } : {}),
      });
      const entities = (response[spec.listKey] ?? []) as MbEntity[];
      return entities.map((entity) => toSummary(spec, entity));
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
      `MusicBrainz adapter has no collection "${collection}". Use: ${Object.keys(COLLECTIONS).join(", ")}.`,
      { kind: "not_found", collectionMissing: true },
    );
  }
  return spec;
}

function toSummary(spec: CollectionSpec, entity: MbEntity): Record<string, unknown> {
  return {
    id: entity.id,
    [spec.nameField]: entity[spec.nameField] ?? null,
    ...(entity.type !== undefined && entity.type !== null ? { type: entity.type } : {}),
    ...(entity.score !== undefined ? { score: entity.score } : {}),
    ...(entity.disambiguation ? { disambiguation: entity.disambiguation } : {}),
  };
}

function toRecord(spec: CollectionSpec, entity: MbEntity, options: { includeLinks: boolean }): Record<string, unknown> {
  const record: Record<string, unknown> = { id: entity.id };
  for (const [fieldName] of spec.fields) {
    record[fieldName] = readField(entity, fieldName);
  }
  if (options.includeLinks) {
    const { externalIds, links } = extractLinkRelations(entity.relations, entity.isnis);
    record.externalIds = externalIds;
    record.links = links;
  }
  return record;
}

/** Map snake_case field names onto MusicBrainz's hyphenated JSON keys. */
function readField(entity: MbEntity, fieldName: string): unknown {
  switch (fieldName) {
    case "sort_name":
      return entity["sort-name"] ?? null;
    case "first_release_date":
      return entity["first-release-date"] ?? null;
    case "label_code":
      return entity["label-code"] ?? null;
    default:
      return (entity as unknown as Record<string, unknown>)[fieldName] ?? null;
  }
}
