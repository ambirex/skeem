import { DirectusClient } from "./client.js";
import type {
  AdapterConfig,
  Collection,
  DirectusCollectionRow,
  DirectusFieldRow,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  Schema,
} from "./types.js";

interface ItemsResponse<T> {
  data: T;
  meta?: {
    filter_count?: number;
  };
}

export function createDirectusAdapter() {
  const client = new DirectusClient();

  return {
    name: "directus",
    connect(config: AdapterConfig) {
      return client.connect(config);
    },
    async introspect(): Promise<Schema> {
      const [collectionsResponse, fieldsResponse] = await Promise.all([
        client.get<ItemsResponse<DirectusCollectionRow[]>>("/collections", { limit: -1 }),
        client.get<ItemsResponse<DirectusFieldRow[]>>("/fields", { limit: -1 }),
      ]);

      const collections = new Map<string, Collection>();

      for (const row of collectionsResponse.data) {
        const collection: Collection = {
          name: row.collection,
          primaryKey: "id",
          fields: new Map(),
          relations: [],
          uniqueConstraints: [],
        };
        collections.set(row.collection, collection);
      }

      for (const row of fieldsResponse.data) {
        const collection: Collection = collections.get(row.collection) ?? {
          name: row.collection,
          primaryKey: "id",
          fields: new Map(),
          relations: [],
          uniqueConstraints: [],
        };

        const field: Field = {
          name: row.field,
          type: mapFieldType(row.schema?.data_type),
          required: Boolean(row.schema && row.schema.is_nullable === false && !row.schema.is_primary_key),
          unique: Boolean(row.schema?.is_unique),
          ...(row.schema?.default_value !== undefined ? { default: row.schema.default_value } : {}),
        };

        collection.fields.set(field.name, field);
        if (row.schema?.is_primary_key) {
          collection.primaryKey = row.field;
        }
        if (row.schema?.is_unique) {
          collection.uniqueConstraints.push({ fields: [row.field] });
        }
        if (row.schema?.foreign_key_table) {
          collection.relations.push({
            type: "m2o",
            field: row.field,
            relatedCollection: row.schema.foreign_key_table,
            relatedField: row.schema.foreign_key_column ?? "id",
          });
        }

        collections.set(collection.name, collection);
      }

      return { collections };
    },
    async get(collection: string, id: string | number, options?: GetOptions): Promise<Record<string, unknown>> {
      const fields = buildFieldsQuery(options?.expand);
      const response = await client.get<ItemsResponse<Record<string, unknown>>>(`/items/${collection}/${id}`, fields ? { fields } : undefined);
      return response.data;
    },
    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      const response = await client.get<ItemsResponse<Record<string, unknown>[]>>(`/items/${collection}`, {
        filter: Object.fromEntries(
          Object.entries(filter).map(([field, value]) => [field, { _eq: value }]),
        ),
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.offset !== undefined ? { offset: options.offset } : {}),
        ...(options?.sort ? { sort: options.sort } : {}),
        ...(options?.expand ? { fields: buildFieldsQuery(options.expand) } : {}),
      });
      return response.data;
    },
    async create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const response = await client.post<ItemsResponse<Record<string, unknown>>>(`/items/${collection}`, data);
      return response.data;
    },
    async update(collection: string, id: string | number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const response = await client.patch<ItemsResponse<Record<string, unknown>>>(`/items/${collection}/${id}`, data);
      return response.data;
    },
    delete(collection: string, id: string | number): Promise<void> {
      return client.delete(`/items/${collection}/${id}`);
    },
    async count(collection: string): Promise<number | null> {
      const response = await client.get<ItemsResponse<Record<string, unknown>[]>>(`/items/${collection}`, {
        limit: 1,
        meta: "filter_count",
      });
      return response.meta?.filter_count ?? null;
    },
  };
}

function buildFieldsQuery(expand?: string[]): string[] | undefined {
  if (!expand || expand.length === 0) {
    return undefined;
  }
  return ["*", ...expand.map((field) => `${field}.*`)];
}

function mapFieldType(dataType?: string | null): FieldType {
  switch (dataType) {
    case "integer":
    case "bigInteger":
      return "integer";
    case "float":
    case "decimal":
      return "float";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "dateTime":
    case "timestamp":
    case "datetime":
      return "datetime";
    case "json":
      return "json";
    case "csv":
      return "csv";
    case "uuid":
      return "uuid";
    case "text":
      return "text";
    default:
      return "string";
  }
}
