import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { PocketBaseClient } from "./client.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  PocketBaseCollection,
  PocketBaseField,
  PocketBaseListResponse,
  Relation,
  Schema,
  SchemaCollectionInput,
  SchemaFieldInput,
  SchemaRelationInput,
} from "./types.js";

export function createPocketBaseAdapter(): SkemAdapter {
  const client = new PocketBaseClient();

  return {
    name: "pocketbase",

    connect(config: AdapterConfig) {
      return client.connect(config);
    },

    async introspect(): Promise<Schema> {
      const res = await client.get<PocketBaseListResponse<PocketBaseCollection>>(
        "/api/collections",
        { perPage: 500 },
      );

      const collections = new Map<string, Collection>();

      for (const col of res.items) {
        if (col.system || col.name.startsWith("_")) {
          continue;
        }

        const uniqueFieldNames = parseUniqueIndexFields(col.indexes, col.name);

        const fields = new Map<string, Field>();
        const relations: Relation[] = [];

        for (const pbField of col.fields) {
          if (pbField.system || pbField.name === "id") {
            continue;
          }

          if (pbField.type === "relation") {
            const relatedCollection = pbField.collectionName;
            if (!relatedCollection) continue;

            // maxSelect: 1 → m2o; anything else → m2m (introspect-only)
            const isM2o = pbField.maxSelect === 1;
            relations.push({
              type: isM2o ? "m2o" : "m2m",
              field: pbField.name,
              relatedCollection,
              relatedField: "id",
            });
            continue;
          }

          const fieldType = mapPbFieldType(pbField);
          const enumValues = pbField.type === "select" && Array.isArray(pbField.values) && pbField.values.length > 0
            ? pbField.values
            : undefined;

          const field: Field = {
            name: pbField.name,
            type: fieldType,
            required: pbField.required === true,
            unique: uniqueFieldNames.has(pbField.name),
            ...(enumValues ? { enum: enumValues } : {}),
          };

          fields.set(field.name, field);
          if (uniqueFieldNames.has(pbField.name)) {
            // uniqueConstraints is populated below
          }
        }

        const uniqueConstraints = Array.from(uniqueFieldNames)
          .filter((name) => fields.has(name))
          .map((name) => ({ fields: [name] }));

        collections.set(col.name, {
          name: col.name,
          primaryKey: "id",
          fields,
          relations,
          uniqueConstraints,
        });
      }

      return { collections };
    },

    async get(collection: string, id: string | number, options?: GetOptions): Promise<Record<string, unknown>> {
      const query: Record<string, unknown> = {};
      if (options?.expand?.length) {
        query.expand = options.expand.join(",");
      }
      return client.get<Record<string, unknown>>(
        `/api/collections/${collection}/records/${id}`,
        Object.keys(query).length ? query : undefined,
      );
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      const query: Record<string, unknown> = {
        perPage: options?.limit ?? 500,
        page: 1,
      };

      if (Object.keys(filter).length > 0) {
        query.filter = buildFilterString(filter);
      }
      if (options?.sort) {
        query.sort = options.sort;
      }
      if (options?.expand?.length) {
        query.expand = options.expand.join(",");
      }
      if (options?.offset !== undefined && options.limit) {
        query.page = Math.floor(options.offset / options.limit) + 1;
      }

      const res = await client.get<PocketBaseListResponse<Record<string, unknown>>>(
        `/api/collections/${collection}/records`,
        query,
      );
      return res.items;
    },

    async create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      return client.post<Record<string, unknown>>(`/api/collections/${collection}/records`, data);
    },

    async update(collection: string, id: string | number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      return client.patch<Record<string, unknown>>(`/api/collections/${collection}/records/${id}`, data);
    },

    delete(collection: string, id: string | number): Promise<void> {
      return client.delete(`/api/collections/${collection}/records/${id}`);
    },

    async count(collection: string): Promise<number | null> {
      const res = await client.get<PocketBaseListResponse<unknown>>(
        `/api/collections/${collection}/records`,
        { perPage: 1, page: 1 },
      );
      return res.totalItems;
    },

    async createCollection(input: SchemaCollectionInput): Promise<void> {
      const uniqueNames = new Set(input.fields.filter((f) => f.unique).map((f) => f.name));
      await client.post("/api/collections", {
        name: input.name,
        type: "base",
        fields: input.fields.map(toPbField),
        indexes: Array.from(uniqueNames).map((name) => makeUniqueIndexSql(input.name, name)),
      });
    },

    async deleteCollection(collection: string): Promise<void> {
      await client.delete(`/api/collections/${collection}`);
    },

    async createField(collection: string, field: SchemaFieldInput): Promise<void> {
      const col = await client.get<PocketBaseCollection>(`/api/collections/${collection}`);
      const updatedFields = [...col.fields, toPbField(field)];
      const updatedIndexes = field.unique
        ? [...col.indexes, makeUniqueIndexSql(collection, field.name)]
        : col.indexes;
      await client.patch(`/api/collections/${collection}`, {
        fields: updatedFields,
        indexes: updatedIndexes,
      });
    },

    async updateField(collection: string, fieldName: string, field: SchemaFieldInput): Promise<void> {
      const col = await client.get<PocketBaseCollection>(`/api/collections/${collection}`);
      const updatedFields = col.fields.map((f) =>
        f.name === fieldName ? { ...toPbField(field), id: f.id } : f,
      );
      // Rebuild indexes: drop any existing unique index for this field and add new one if needed.
      const filteredIndexes = col.indexes.filter((idx) => !isUniqueIndexForField(idx, collection, fieldName));
      const updatedIndexes = field.unique
        ? [...filteredIndexes, makeUniqueIndexSql(collection, field.name)]
        : filteredIndexes;
      await client.patch(`/api/collections/${collection}`, {
        fields: updatedFields,
        indexes: updatedIndexes,
      });
    },

    async deleteField(collection: string, fieldName: string): Promise<void> {
      const col = await client.get<PocketBaseCollection>(`/api/collections/${collection}`);
      await client.patch(`/api/collections/${collection}`, {
        fields: col.fields.filter((f) => f.name !== fieldName),
        indexes: col.indexes.filter((idx) => !isUniqueIndexForField(idx, collection, fieldName)),
      });
    },

    async createRelation(input: SchemaRelationInput): Promise<void> {
      if (input.type === "m2m") {
        throw new AdapterError(
          "PocketBase does not use junction collections; m2m relation writes are not supported. " +
          "Use a relation field with maxSelect > 1 instead, or choose a different backend.",
          { kind: "unknown" },
        );
      }

      // Look up the related collection's id.
      const relatedCol = await client.get<PocketBaseCollection>(`/api/collections/${input.relatedCollection}`);
      const col = await client.get<PocketBaseCollection>(`/api/collections/${input.collection}`);

      await client.patch(`/api/collections/${input.collection}`, {
        fields: [
          ...col.fields,
          {
            name: input.field,
            type: "relation",
            required: false,
            collectionId: relatedCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
        ],
        indexes: col.indexes,
      });
    },

    async updateRelation(from: SchemaRelationInput, to: SchemaRelationInput): Promise<void> {
      if (from.type === "m2m" || to.type === "m2m") {
        throw new AdapterError(
          "PocketBase m2m relation writes are not supported.",
          { kind: "unknown" },
        );
      }
      await this.deleteRelation!(from);
      await this.createRelation!(to);
    },

    async deleteRelation(input: SchemaRelationInput): Promise<void> {
      if (input.type === "m2m") {
        throw new AdapterError(
          "PocketBase m2m relation writes are not supported.",
          { kind: "unknown" },
        );
      }
      const col = await client.get<PocketBaseCollection>(`/api/collections/${input.collection}`);
      await client.patch(`/api/collections/${input.collection}`, {
        fields: col.fields.filter((f) => f.name !== input.field),
        indexes: col.indexes,
      });
    },

    // m2m in PocketBase is an array of related ids on the record's relation
    // field (there is no junction collection), so link/unlink read-modify-write
    // that array. Reporting accurate `changed` is cheap given the read.
    async link(collection: string, id: string | number, relation: Relation, targetId: string | number) {
      const record = await client.get<Record<string, unknown>>(`/api/collections/${collection}/records/${id}`);
      const current = toIdArray(record[relation.field]);
      if (current.includes(String(targetId))) {
        return { changed: false };
      }
      await client.patch(`/api/collections/${collection}/records/${id}`, {
        [relation.field]: [...current, String(targetId)],
      });
      return { changed: true };
    },

    async unlink(collection: string, id: string | number, relation: Relation, targetId: string | number) {
      const record = await client.get<Record<string, unknown>>(`/api/collections/${collection}/records/${id}`);
      const current = toIdArray(record[relation.field]);
      if (!current.includes(String(targetId))) {
        return { changed: false };
      }
      await client.patch(`/api/collections/${collection}/records/${id}`, {
        [relation.field]: current.filter((value) => value !== String(targetId)),
      });
      return { changed: true };
    },
  } satisfies SkemAdapter;
}

function toIdArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function mapPbFieldType(field: PocketBaseField): FieldType {
  switch (field.type) {
    case "text":
      return "string";
    case "editor":
      return "text";
    case "number":
      return "float";
    case "bool":
      return "boolean";
    case "date":
    case "autodate":
      return "datetime";
    case "json":
      return "json";
    case "select":
      return "string";
    case "email":
    case "url":
    case "file":
    case "password":
    default:
      return "string";
  }
}

function toPbField(field: SchemaFieldInput): PocketBaseField {
  const pbType = mapSkemTypeToPb(field.type);
  const result: PocketBaseField = {
    name: field.name,
    type: pbType,
    required: field.required === true,
  };
  if (pbType === "select" || (field.enum && field.enum.length > 0)) {
    result.type = "select";
    result.values = field.enum ?? [];
    result.maxSelect = 1;
  }
  return result;
}

function mapSkemTypeToPb(type: FieldType): string {
  switch (type) {
    case "string":
      return "text";
    case "text":
      return "editor";
    case "integer":
    case "float":
      return "number";
    case "boolean":
      return "bool";
    case "date":
    case "datetime":
      return "date";
    case "json":
      return "json";
    default:
      return "text";
  }
}

function buildFilterString(filter: Record<string, string | number | boolean | null>): string {
  return Object.entries(filter)
    .map(([key, value]) => {
      if (value === null) return `${key} = null`;
      if (typeof value === "string") return `${key} = "${value}"`;
      return `${key} = ${value}`;
    })
    .join(" && ");
}

function parseUniqueIndexFields(indexes: string[], collection: string): Set<string> {
  const unique = new Set<string>();
  for (const idx of indexes) {
    const match = /CREATE\s+UNIQUE\s+INDEX\s+\S+\s+ON\s+`?[\w]+`?\s+\(`?([\w]+)`?\)/i.exec(idx);
    if (match) {
      unique.add(match[1]!);
    }
  }
  return unique;
}

function makeUniqueIndexSql(collection: string, field: string): string {
  return `CREATE UNIQUE INDEX \`idx_${collection}_${field}\` ON \`${collection}\` (\`${field}\`)`;
}

function isUniqueIndexForField(indexSql: string, collection: string, field: string): boolean {
  return indexSql.toLowerCase().includes(`on \`${collection}\``) &&
    indexSql.toLowerCase().includes(`(\`${field}\`)`) &&
    indexSql.toLowerCase().includes("unique");
}

