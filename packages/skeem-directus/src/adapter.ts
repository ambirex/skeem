import { DirectusClient } from "./client.js";
import type {
  AdapterConfig,
  Collection,
  DirectusCollectionRow,
  DirectusFieldRow,
  DirectusRelationRow,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  Relation,
  Schema,
  SchemaCollectionInput,
  SchemaFieldInput,
  SchemaRelationInput,
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
      const [collectionsResponse, fieldsResponse, relationsResponse] = await Promise.all([
        client.get<ItemsResponse<DirectusCollectionRow[]>>("/collections", { limit: -1 }),
        client.get<ItemsResponse<DirectusFieldRow[]>>("/fields", { limit: -1 }),
        client.get<ItemsResponse<DirectusRelationRow[]>>("/relations", { limit: -1 }),
      ]);

      const collections = new Map<string, Collection>();

      for (const row of collectionsResponse.data) {
        collections.set(row.collection, {
          name: row.collection,
          primaryKey: "id",
          fields: new Map(),
          relations: [],
          uniqueConstraints: [],
        });
      }

      for (const row of fieldsResponse.data) {
        const collection = collections.get(row.collection) ?? createCollection(row.collection);
        collections.set(collection.name, collection);

        if (row.type === "alias" || row.meta?.special?.includes("m2m")) {
          continue;
        }

        const field: Field = {
          name: row.field,
          type: mapFieldType(row.schema?.data_type),
          required: Boolean(row.schema && row.schema.is_nullable === false && !row.schema.is_primary_key),
          unique: Boolean(row.schema?.is_unique),
          ...(row.schema?.default_value !== undefined && row.schema.default_value !== null
            ? { default: row.schema.default_value }
            : {}),
        };

        collection.fields.set(field.name, field);
        if (row.schema?.is_primary_key) {
          collection.primaryKey = row.field;
        }
        if (row.schema?.is_unique) {
          collection.uniqueConstraints.push({ fields: [row.field] });
        }
      }

      const relationRows = relationsResponse.data;
      const relationByCollectionField = new Map(relationRows.map((row) => [relationKey(row.collection, row.field), row]));

      for (const row of relationRows) {
        const collection = collections.get(row.collection) ?? createCollection(row.collection);
        collections.set(collection.name, collection);

        if (isManyToManyHalf(row)) {
          collection.isJunction = true;
          const sibling = relationByCollectionField.get(relationKey(row.collection, row.meta?.junction_field ?? ""));
          if (!sibling || !isManyToManyHalf(sibling) || !row.meta?.one_field) {
            continue;
          }

          const ownerCollection = collections.get(row.related_collection) ?? createCollection(row.related_collection);
          collections.set(ownerCollection.name, ownerCollection);

          const m2mRelation: Relation = {
            type: "m2m",
            field: row.meta.one_field,
            relatedCollection: sibling.related_collection,
            relatedField: sibling.meta?.one_field ?? sibling.related_collection,
            junctionCollection: row.collection,
            junctionLocalField: row.field,
            junctionForeignField: row.meta.junction_field ?? sibling.field,
          };

          if (!ownerCollection.relations.some((relation) => (
            relation.type === "m2m" &&
            relation.field === m2mRelation.field &&
            relation.relatedCollection === m2mRelation.relatedCollection &&
            relation.junctionCollection === m2mRelation.junctionCollection
          ))) {
            ownerCollection.relations.push(m2mRelation);
          }
          continue;
        }

        if (!row.schema?.foreign_key_table) {
          continue;
        }

        if (!collection.relations.some((relation) => relation.type === "m2o" && relation.field === row.field)) {
          collection.relations.push({
            type: "m2o",
            field: row.field,
            relatedCollection: row.schema.foreign_key_table,
            relatedField: row.schema.foreign_key_column ?? "id",
            ...(row.meta?.one_field ? { junctionCollection: undefined } : {}),
          });
        }
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
    async createCollection(input: SchemaCollectionInput): Promise<void> {
      await client.post("/collections", {
        collection: input.name,
        meta: {
          collection: input.name,
          icon: "inventory_2",
        },
        schema: {
          name: input.name,
        },
        fields: input.fields.map((field) => toDirectusFieldPayload(field, input.name)),
      });
    },
    async deleteCollection(collection: string): Promise<void> {
      await client.delete(`/collections/${collection}`);
    },
    async createField(collection: string, field: SchemaFieldInput): Promise<void> {
      if (field.type === "string" && field.enum && field.enum.length > 0) {
        throw new Error(`Directus adapter does not support enum field creation for "${collection}.${field.name}" yet.`);
      }

      await client.post(`/fields/${collection}`, toDirectusFieldPayload(field, collection));
    },
    async updateField(collection: string, fieldName: string, field: SchemaFieldInput): Promise<void> {
      if (field.type === "string" && field.enum && field.enum.length > 0) {
        throw new Error(`Directus adapter does not support enum field updates for "${collection}.${fieldName}" yet.`);
      }

      await client.patch(`/fields/${collection}/${fieldName}`, toDirectusFieldPayload(field, collection, { forUpdate: true }));
    },
    async deleteField(collection: string, fieldName: string): Promise<void> {
      await client.delete(`/fields/${collection}/${fieldName}`);
    },
    async createRelation(input: SchemaRelationInput): Promise<void> {
      if (input.type === "m2m") {
        await createManyToManyRelation(client, input);
        return;
      }

      await client.post("/relations", {
        collection: input.collection,
        field: input.field,
        related_collection: input.relatedCollection,
        schema: {
          table: input.collection,
          column: input.field,
          foreign_key_table: input.relatedCollection,
          foreign_key_column: "id",
          on_update: "NO ACTION",
          on_delete: "SET NULL",
        },
        meta: {
          many_collection: input.collection,
          many_field: input.field,
          one_collection: input.relatedCollection,
          ...(input.inverseField ? { one_field: input.inverseField } : {}),
          one_deselect_action: "nullify",
        },
      });
    },
    async updateRelation(input: SchemaRelationInput & {
      currentRelatedCollection?: string;
      currentType?: Relation["type"];
      currentInverseField?: string;
      currentJunctionCollection?: string;
      currentJunctionField?: string;
      currentInverseJunctionField?: string;
    }): Promise<void> {
      await deleteRelationByShape(client, {
        collection: input.collection,
        field: input.field,
        relatedCollection: input.currentRelatedCollection ?? input.relatedCollection,
        type: input.currentType ?? input.type,
        ...(input.currentInverseField ? { inverseField: input.currentInverseField } : {}),
        ...(input.currentJunctionCollection ? { junctionCollection: input.currentJunctionCollection } : {}),
        ...(input.currentJunctionField ? { junctionField: input.currentJunctionField } : {}),
        ...(input.currentInverseJunctionField ? { inverseJunctionField: input.currentInverseJunctionField } : {}),
      });
      if (input.type === "m2m") {
        await createManyToManyRelation(client, input);
        return;
      }
      await client.post("/relations", {
        collection: input.collection,
        field: input.field,
        related_collection: input.relatedCollection,
        schema: {
          table: input.collection,
          column: input.field,
          foreign_key_table: input.relatedCollection,
          foreign_key_column: "id",
          on_update: "NO ACTION",
          on_delete: "SET NULL",
        },
        meta: {
          many_collection: input.collection,
          many_field: input.field,
          one_collection: input.relatedCollection,
          ...(input.inverseField ? { one_field: input.inverseField } : {}),
          one_deselect_action: "nullify",
        },
      });
    },
    async deleteRelation(input: SchemaRelationInput): Promise<void> {
      await deleteRelationByShape(client, input);
    },
  };
}

function buildFieldsQuery(expand?: string[]): string[] | undefined {
  if (!expand || expand.length === 0) {
    return undefined;
  }
  return ["*", ...expand.map((field) => `${field}.*`)];
}

function createCollection(name: string): Collection {
  return {
    name,
    primaryKey: "id",
    fields: new Map(),
    relations: [],
    uniqueConstraints: [],
  };
}

function relationKey(collection: string, field: string): string {
  return `${collection}::${field}`;
}

function isManyToManyHalf(row: DirectusRelationRow): boolean {
  return Boolean(row.meta?.junction_field && row.meta?.one_field);
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

function toDirectusFieldPayload(
  field: SchemaFieldInput,
  collection: string,
  options?: { forUpdate?: boolean },
): Record<string, unknown> {
  const mapped = mapSchemaField(field.type);
  const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");

  return {
    field: field.name,
    type: mapped.type,
    meta: {
      interface: mapped.interface,
      width: "full",
      required: field.required === true,
    },
    schema: {
      name: field.name,
      table: collection,
      data_type: mapped.dataType,
      is_nullable: field.required === true ? false : true,
      is_unique: field.unique === true,
      ...(mapped.maxLength !== undefined ? { max_length: mapped.maxLength } : {}),
      ...((hasDefault || field.clearDefault) ? { default_value: hasDefault ? field.default : null } : {}),
      ...((options?.forUpdate && !hasDefault && !field.clearDefault) ? {} : {}),
    },
  };
}

function mapSchemaField(type: FieldType): {
  type: string;
  dataType: string;
  interface: string;
  maxLength?: number;
} {
  switch (type) {
    case "text":
      return { type: "text", dataType: "text", interface: "input-multiline" };
    case "integer":
      return { type: "integer", dataType: "integer", interface: "input" };
    case "float":
      return { type: "float", dataType: "float", interface: "input" };
    case "boolean":
      return { type: "boolean", dataType: "boolean", interface: "boolean" };
    case "datetime":
      return { type: "timestamp", dataType: "timestamp", interface: "datetime" };
    case "date":
      return { type: "date", dataType: "date", interface: "datetime" };
    case "json":
      return { type: "json", dataType: "json", interface: "input-code" };
    case "uuid":
      return { type: "uuid", dataType: "uuid", interface: "input" };
    case "csv":
      return { type: "csv", dataType: "text", interface: "tags" };
    case "string":
    default:
      return { type: "string", dataType: "varchar", interface: "input", maxLength: 255 };
  }
}

async function createManyToManyRelation(client: DirectusClient, input: SchemaRelationInput): Promise<void> {
  const inverseField = input.inverseField ?? input.collection;
  const junctionCollection = input.junctionCollection ?? makeJunctionCollectionName(input.collection, input.relatedCollection);
  const leftField = input.junctionField ?? makeJunctionFieldName(input.collection);
  const rightField = input.inverseJunctionField ?? makeJunctionFieldName(input.relatedCollection);

  await client.post(`/fields/${input.collection}`, createAliasFieldPayload(input.field));
  await client.post(`/fields/${input.relatedCollection}`, createAliasFieldPayload(inverseField));
  await client.post("/collections", {
    collection: junctionCollection,
    meta: {
      collection: junctionCollection,
      icon: "link",
    },
    schema: {
      name: junctionCollection,
    },
    fields: [
      toDirectusFieldPayload({ name: leftField, type: "integer" }, junctionCollection),
      toDirectusFieldPayload({ name: rightField, type: "integer" }, junctionCollection),
    ],
  });

  await client.post("/relations", {
    collection: junctionCollection,
    field: leftField,
    related_collection: input.collection,
    meta: {
      many_collection: junctionCollection,
      many_field: leftField,
      one_collection: input.collection,
      one_field: input.field,
      junction_field: rightField,
      one_deselect_action: "delete",
    },
    schema: {
      table: junctionCollection,
      column: leftField,
      foreign_key_table: input.collection,
      foreign_key_column: "id",
      on_update: "NO ACTION",
      on_delete: "CASCADE",
    },
  });

  await client.post("/relations", {
    collection: junctionCollection,
    field: rightField,
    related_collection: input.relatedCollection,
    meta: {
      many_collection: junctionCollection,
      many_field: rightField,
      one_collection: input.relatedCollection,
      one_field: inverseField,
      junction_field: leftField,
      one_deselect_action: "delete",
    },
    schema: {
      table: junctionCollection,
      column: rightField,
      foreign_key_table: input.relatedCollection,
      foreign_key_column: "id",
      on_update: "NO ACTION",
      on_delete: "CASCADE",
    },
  });
}

async function deleteManyToManyRelation(client: DirectusClient, input: SchemaRelationInput): Promise<void> {
  const inverseField = input.inverseField ?? input.collection;
  const junctionCollection = input.junctionCollection ?? makeJunctionCollectionName(input.collection, input.relatedCollection);
  const leftField = input.junctionField ?? makeJunctionFieldName(input.collection);
  const rightField = input.inverseJunctionField ?? makeJunctionFieldName(input.relatedCollection);

  await deleteRelationIfExists(client, junctionCollection, leftField);
  await deleteRelationIfExists(client, junctionCollection, rightField);
  await deleteFieldIfExists(client, input.collection, input.field);
  await deleteFieldIfExists(client, input.relatedCollection, inverseField);
  await deleteCollectionIfExists(client, junctionCollection);
}

async function deleteRelationByShape(client: DirectusClient, input: SchemaRelationInput): Promise<void> {
  if (input.type === "m2m") {
    await deleteManyToManyRelation(client, input);
    return;
  }

  const relationId = await findRelationId(client, input.collection, input.field);
  await client.delete(`/relations/${relationId}`);
}

async function deleteRelationIfExists(client: DirectusClient, collection: string, field: string): Promise<void> {
  try {
    const relationId = await findRelationId(client, collection, field);
    await client.delete(`/relations/${relationId}`);
  } catch {
    // Best-effort cleanup.
  }
}

async function deleteFieldIfExists(client: DirectusClient, collection: string, field: string): Promise<void> {
  try {
    await client.delete(`/fields/${collection}/${field}`);
  } catch {
    // Best-effort cleanup.
  }
}

async function deleteCollectionIfExists(client: DirectusClient, collection: string): Promise<void> {
  try {
    await client.delete(`/collections/${collection}`);
  } catch {
    // Best-effort cleanup.
  }
}

async function findRelationId(client: DirectusClient, collection: string, field: string): Promise<number> {
  const response = await client.get<ItemsResponse<DirectusRelationRow[]>>(`/relations/${collection}`);
  const relation = response.data.find((entry) => entry.field === field);
  if (typeof relation?.meta?.id !== "number") {
    throw new Error(`Could not resolve relation id for "${collection}.${field}".`);
  }
  return relation.meta.id;
}

function createAliasFieldPayload(field: string): Record<string, unknown> {
  return {
    field,
    type: "alias",
    meta: {
      special: ["m2m"],
      interface: "list-m2m",
      display: "related-values",
      width: "full",
      hidden: false,
      required: false,
    },
  };
}

function makeJunctionCollectionName(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join("_");
}

function makeJunctionFieldName(collection: string): string {
  return `${collection}_id`;
}
