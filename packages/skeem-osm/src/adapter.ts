import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { OsmClient } from "./client.js";
import { externalIdsFromTags } from "./tags.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FindOptions,
  GetOptions,
  NominatimResult,
  OsmElementType,
  OsmElementsResponse,
  Schema,
} from "./types.js";

const READ_ONLY_MESSAGE = "The OpenStreetMap adapter is read-only — it supports `get`, `find`, `describe`, `discover`, and `ls` only.";
const ELEMENT_TYPES = new Set<OsmElementType>(["node", "way", "relation"]);
const NOMINATIM_MAX = 40;

/**
 * Read-only adapter over OpenStreetMap. One synthetic collection — `elements` —
 * keyed by a type-prefixed id (`node/123`, `way/5013364`, `relation/62422`),
 * because numeric OSM ids collide across element types and a searcher cannot
 * know the type in advance. `get` fetches the element from the OSM 0.6 API;
 * `find` searches by name via Nominatim (which cannot filter by element type
 * server-side — another reason for the single collection). Tag-derived
 * externalIds use only the element's own identity tags (`wikidata`,
 * `wikipedia`, `website`) — see src/tags.ts for the brand:wikidata caveat.
 */
export function createOsmAdapter(): SkemAdapter {
  const client = new OsmClient();

  return {
    name: "osm",

    async connect(config: AdapterConfig) {
      client.connect(config);
    },

    async introspect(): Promise<Schema> {
      const fields = new Map<string, Field>([
        ["id", { name: "id", type: "string", required: true, unique: true }],
        ["type", { name: "type", type: "string", required: true, unique: false, enum: ["node", "way", "relation"] }],
        ["name", { name: "name", type: "string", required: false, unique: false }],
        ["lat", { name: "lat", type: "float", required: false, unique: false }],
        ["lon", { name: "lon", type: "float", required: false, unique: false }],
        ["tags", { name: "tags", type: "json", required: false, unique: false }],
        ["externalIds", { name: "externalIds", type: "json", required: false, unique: false }],
      ]);
      const collections = new Map<string, Collection>([
        ["elements", { name: "elements", primaryKey: "id", fields, relations: [], uniqueConstraints: [] }],
      ]);
      return { collections };
    },

    async get(collection: string, id: string | number, _options?: GetOptions): Promise<Record<string, unknown>> {
      requireElements(collection);
      const { type, numericId } = parseElementId(id);
      const response = await client.element<OsmElementsResponse>(`/api/0.6/${type}/${numericId}.json`);
      const element = response.elements?.[0];
      if (!element) {
        throw new AdapterError(`OpenStreetMap has no ${type} ${numericId}.`, { kind: "not_found" });
      }
      return {
        id: `${element.type}/${element.id}`,
        type: element.type,
        name: element.tags?.name ?? null,
        ...(element.lat !== undefined ? { lat: element.lat } : {}),
        ...(element.lon !== undefined ? { lon: element.lon } : {}),
        tags: element.tags ?? {},
        externalIds: externalIdsFromTags(element.tags),
        ...(element.nodes ? { nodes: element.nodes } : {}),
        ...(element.members ? { members: element.members } : {}),
      };
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      requireElements(collection);

      if (options?.sort) {
        throw new AdapterError("OpenStreetMap find does not support --sort.", { kind: "validation", field: "sort" });
      }
      if (options?.offset !== undefined) {
        throw new AdapterError(
          "OpenStreetMap find does not support --offset (Nominatim has no stable pagination).",
          { kind: "validation", field: "offset" },
        );
      }

      if (filter.id !== undefined && filter.id !== null) {
        const record = await this.get(collection, String(filter.id)).catch((error: unknown) => {
          if (error instanceof AdapterError && error.kind === "not_found") return undefined;
          throw error;
        });
        return record ? [record] : [];
      }

      const query = filter.q ?? filter.search ?? filter.name;
      if (query === undefined || query === null) {
        throw new AdapterError(
          "OpenStreetMap find supports --where name=<text> (or q=/search=) and --where id=<type/id>.",
          { kind: "validation", field: "name" },
        );
      }

      const limit = Math.min(options?.limit ?? 10, NOMINATIM_MAX);
      const results = await client.search<NominatimResult[]>({
        q: String(query),
        format: "jsonv2",
        extratags: 1,
        limit,
      });

      return results
        .filter((entry) => ELEMENT_TYPES.has(entry.osm_type as OsmElementType))
        .map((entry) => ({
          id: `${entry.osm_type}/${entry.osm_id}`,
          type: entry.osm_type,
          name: entry.name ?? entry.display_name ?? null,
          display_name: entry.display_name ?? null,
          class: entry.class ?? entry.category ?? null,
          ...(entry.lat !== undefined ? { lat: Number(entry.lat) } : {}),
          ...(entry.lon !== undefined ? { lon: Number(entry.lon) } : {}),
          externalIds: externalIdsFromTags(entry.extratags ?? undefined),
        }));
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

function requireElements(collection: string): void {
  if (collection !== "elements") {
    throw new AdapterError(
      `OpenStreetMap adapter has no collection "${collection}". Use "elements" (ids are "node/123", "way/123", "relation/123").`,
      { kind: "not_found", collectionMissing: true },
    );
  }
}

function parseElementId(id: string | number): { type: OsmElementType; numericId: string } {
  const raw = String(id).trim();
  const match = /^(node|way|relation)\/(\d+)$/.exec(raw);
  if (!match) {
    throw new AdapterError(
      `OpenStreetMap element ids are "<type>/<id>" (e.g. "way/5013364"); got "${raw}".`,
      { kind: "validation", field: "id" },
    );
  }
  return { type: match[1] as OsmElementType, numericId: match[2]! };
}
