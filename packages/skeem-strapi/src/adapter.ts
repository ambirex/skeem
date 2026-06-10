import type { SkemAdapter } from "@skeems/types";
import { StrapiClient } from "./client.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  Relation,
  Schema,
  StrapiAttribute,
  StrapiContentType,
  StrapiListResponse,
  StrapiSingleResponse,
} from "./types.js";

const CANONICAL_PK = "id";

/**
 * Strapi adapter — **Data tier**. Strapi mutates content types only in dev mode
 * (with a server restart), so this adapter implements discovery + CRUD only and
 * omits the schema-mutation methods; `define`/`init` fail with skeem's standard
 * capability errors.
 *
 * Introspection reads the content-type-builder admin API (admin JWT); CRUD uses
 * the public `/api/*` routes (Bearer API token). Strapi v5 keys records by
 * `documentId`, which the adapter canonicalizes to `id`.
 */
export function createStrapiAdapter(): SkemAdapter {
  const client = new StrapiClient();

  return {
    name: "strapi",

    async connect(config: AdapterConfig) {
      client.connect(config);
    },

    async introspect(): Promise<Schema> {
      const response = await client.adminGet<{ data: StrapiContentType[] }>(
        "/content-type-builder/content-types",
      );
      const contentTypes = (response.data ?? []).filter(
        (ct) => ct.uid.startsWith("api::") && ct.schema?.kind === "collectionType",
      );

      // Resolve relation targets (uids) to collection names (plural names).
      const pluralByUid = new Map<string, string>();
      for (const ct of contentTypes) {
        pluralByUid.set(ct.uid, ct.schema.pluralName);
      }

      const collections = new Map<string, Collection>();
      for (const ct of contentTypes) {
        const fields = new Map<string, Field>();
        const relations: Relation[] = [];
        const uniqueConstraints: { fields: string[] }[] = [];

        for (const [name, attr] of Object.entries(ct.schema.attributes ?? {})) {
          if (attr.type === "relation") {
            const relatedCollection = attr.target
              ? pluralByUid.get(attr.target) ?? targetName(attr.target)
              : undefined;
            if (!relatedCollection || !attr.relation) continue;
            relations.push({
              type: mapRelation(attr.relation),
              field: name,
              relatedCollection,
              relatedField: CANONICAL_PK,
            });
            continue;
          }

          const fieldType = mapAttributeType(attr.type);
          if (!fieldType) {
            continue; // component, dynamiczone, media handled as out-of-scope
          }
          const field: Field = {
            name,
            type: fieldType,
            required: attr.required === true,
            unique: attr.unique === true,
            ...(attr.type === "enumeration" && Array.isArray(attr.enum) ? { enum: attr.enum } : {}),
          };
          fields.set(name, field);
          if (attr.unique) {
            uniqueConstraints.push({ fields: [name] });
          }
        }

        collections.set(ct.schema.pluralName, {
          name: ct.schema.pluralName,
          primaryKey: CANONICAL_PK,
          fields,
          relations,
          uniqueConstraints,
        });
      }

      return { collections };
    },

    async get(collection: string, id: string | number, options?: GetOptions): Promise<Record<string, unknown>> {
      const query: Record<string, unknown> = {};
      applyPopulate(query, options?.expand);
      const response = await client.data<StrapiSingleResponse<Record<string, unknown>>>(
        "GET",
        `/api/${collection}/${encodeURIComponent(String(id))}`,
        { query },
      );
      return mapRecordOut(response.data);
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      const query: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(filter)) {
        if (value === null) {
          query[`filters[${field}][$null]`] = "true";
        } else {
          query[`filters[${field}][$eq]`] = value;
        }
      }
      if (options?.sort) {
        query["sort[0]"] = options.sort.startsWith("-")
          ? `${options.sort.slice(1)}:desc`
          : `${options.sort}:asc`;
      }
      query["pagination[start]"] = options?.offset ?? 0;
      query["pagination[limit]"] = options?.limit ?? 100;
      applyPopulate(query, options?.expand);

      const response = await client.data<StrapiListResponse<Record<string, unknown>>>(
        "GET",
        `/api/${collection}`,
        { query },
      );
      return (response.data ?? []).map(mapRecordOut);
    },

    async create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const response = await client.data<StrapiSingleResponse<Record<string, unknown>>>(
        "POST",
        `/api/${collection}`,
        { body: { data: stripCanonicalPk(data) } },
      );
      return mapRecordOut(response.data);
    },

    async update(collection: string, id: string | number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const response = await client.data<StrapiSingleResponse<Record<string, unknown>>>(
        "PUT",
        `/api/${collection}/${encodeURIComponent(String(id))}`,
        { body: { data: stripCanonicalPk(data) } },
      );
      return mapRecordOut(response.data);
    },

    async delete(collection: string, id: string | number): Promise<void> {
      await client.data("DELETE", `/api/${collection}/${encodeURIComponent(String(id))}`);
    },

    async count(collection: string): Promise<number | null> {
      const response = await client.data<StrapiListResponse<unknown>>(
        "GET",
        `/api/${collection}`,
        { query: { "pagination[pageSize]": 1, "pagination[withCount]": "true" } },
      );
      return response.meta?.pagination?.total ?? null;
    },
  } satisfies SkemAdapter;
}

/** Strapi v5 records carry both a numeric `id` and the canonical `documentId`.
 *  skeem keys on `documentId`, surfaced as `id`. */
function mapRecordOut(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== "object") return record;
  const { id: _numericId, documentId, ...rest } = record as Record<string, unknown> & { documentId?: unknown };
  if (documentId === undefined) {
    return record;
  }
  return { [CANONICAL_PK]: documentId, ...rest };
}

function stripCanonicalPk(data: Record<string, unknown>): Record<string, unknown> {
  if (!(CANONICAL_PK in data)) return data;
  const { [CANONICAL_PK]: _omit, ...rest } = data;
  return rest;
}

function applyPopulate(query: Record<string, unknown>, expand?: string[]): void {
  if (!expand || expand.length === 0) return;
  expand.forEach((relation, index) => {
    query[`populate[${index}]`] = relation;
  });
}

function targetName(uid: string): string {
  // Fallback for relation targets outside the api:: set (e.g. plugin content
  // types): use the content-type name segment of the uid.
  const match = /::([^.]+)\./.exec(uid);
  return match ? match[1]! : uid;
}

function mapRelation(relation: StrapiAttribute["relation"]): Relation["type"] {
  switch (relation) {
    case "oneToMany":
      return "o2m";
    case "manyToMany":
      return "m2m";
    case "manyToOne":
    case "oneToOne":
    default:
      return "m2o";
  }
}

function mapAttributeType(type: string): FieldType | undefined {
  switch (type) {
    case "text":
    case "richtext":
      return "text";
    case "integer":
    case "biginteger":
      return "integer";
    case "float":
    case "decimal":
      return "float";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
    case "time":
      return "datetime";
    case "json":
    case "blocks":
    case "media":
      return "json";
    case "string":
    case "email":
    case "password":
    case "uid":
    case "enumeration":
      return "string";
    case "component":
    case "dynamiczone":
      return undefined;
    default:
      return "string";
  }
}
