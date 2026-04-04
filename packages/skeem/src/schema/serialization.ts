import type { Collection, Field, Relation, Schema, UniqueConstraint } from "../types/index.js";

export interface SerializedSchema {
  collections: Array<{
    name: string;
    primaryKey: string;
    fields: Field[];
    relations: Relation[];
    uniqueConstraints: UniqueConstraint[];
    isJunction?: boolean;
  }>;
}

export interface SchemaDocument {
  name: string;
  collections: Record<
    string,
    {
      fields: Record<
        string,
        {
          type: Field["type"];
          required?: boolean;
          unique?: boolean;
          default?: unknown;
          enum?: string[];
        }
      >;
      relations?: Record<
        string,
        {
          collection: string;
          type: Relation["type"];
        }
      >;
      uniqueConstraints?: string[][];
    }
  >;
  relations?: string[];
}

export interface DescribeDocument {
  name: string;
  primaryKey: string;
  fields: Array<{
    name: string;
    type: Field["type"];
    required: boolean;
    unique: boolean;
    default?: unknown;
    enum?: string[];
  }>;
  relations: Array<{
    field: string;
    type: Relation["type"];
    relatedCollection: string;
    relatedField: string;
    junctionCollection?: string;
  }>;
  uniqueConstraints: UniqueConstraint[];
}

export function serializeSchema(schema: Schema): SerializedSchema {
  return {
    collections: Array.from(schema.collections.values()).map((collection) => ({
      name: collection.name,
      primaryKey: collection.primaryKey,
      fields: Array.from(collection.fields.values()),
      relations: collection.relations,
      uniqueConstraints: collection.uniqueConstraints,
      ...(collection.isJunction ? { isJunction: true } : {}),
    })),
  };
}

export function deserializeSchema(serialized: SerializedSchema): Schema {
  return {
    collections: new Map(
      serialized.collections.map((collection) => [
        collection.name,
        {
          name: collection.name,
          primaryKey: collection.primaryKey,
          fields: new Map(collection.fields.map((field) => [field.name, field])),
          relations: collection.relations,
          uniqueConstraints: collection.uniqueConstraints,
          ...(collection.isJunction ? { isJunction: true } : {}),
        } satisfies Collection,
      ]),
    ),
  };
}

export function schemaToDocument(
  schema: Schema,
  options?: {
    name?: string;
    collections?: string[];
  },
): SchemaDocument {
  const selectedNames = options?.collections
    ? [...options.collections].sort((left, right) => left.localeCompare(right))
    : Array.from(schema.collections.values())
      .filter((collection) => collection.isJunction !== true)
      .map((collection) => collection.name)
      .sort((left, right) => left.localeCompare(right));
  const selected = new Set(selectedNames);

  const collections = Object.fromEntries(
    selectedNames.map((collectionName) => {
      const collection = requireCollection(schema, collectionName);
      const fields = Object.fromEntries(
        Array.from(collection.fields.values())
          .filter((field) => field.name !== collection.primaryKey)
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((field) => [
            field.name,
            {
              type: field.type,
              ...(field.required ? { required: true } : {}),
              ...(field.unique ? { unique: true } : {}),
              ...(field.default !== undefined ? { default: field.default } : {}),
              ...(field.enum && field.enum.length > 0 ? { enum: field.enum } : {}),
            },
          ]),
      );

      const relations = Object.fromEntries(
        collection.relations
          .filter((relation) => relation.type !== "m2m" && selected.has(relation.relatedCollection))
          .sort((left, right) => left.field.localeCompare(right.field))
          .map((relation) => [
            relation.field,
            {
              collection: relation.relatedCollection,
              type: relation.type,
            },
          ]),
      );

      const uniqueConstraints = collection.uniqueConstraints
        .map((constraint) => [...constraint.fields].sort((left, right) => left.localeCompare(right)))
        .filter((fields) => fields.length > 1)
        .sort((left, right) => left.join(",").localeCompare(right.join(",")));

      return [
        collection.name,
        {
          fields,
          ...(Object.keys(relations).length > 0 ? { relations } : {}),
          ...(uniqueConstraints.length > 0 ? { uniqueConstraints } : {}),
        },
      ];
    }),
  );

  const manyToManyRelations = Array.from(
    new Set(
      selectedNames.flatMap((collectionName) => {
        const collection = requireCollection(schema, collectionName);
        return collection.relations
          .filter((relation) => relation.type === "m2m" && selected.has(relation.relatedCollection))
          .map((relation) => relationString(collection.name, relation.relatedCollection));
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    name: options?.name ?? "discovered-schema",
    collections,
    ...(manyToManyRelations.length > 0 ? { relations: manyToManyRelations } : {}),
  };
}

export function describeCollection(collection: Collection): DescribeDocument {
  return {
    name: collection.name,
    primaryKey: collection.primaryKey,
    fields: Array.from(collection.fields.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        unique: field.unique,
        ...(field.default !== undefined ? { default: field.default } : {}),
        ...(field.enum && field.enum.length > 0 ? { enum: field.enum } : {}),
      })),
    relations: collection.relations
      .slice()
      .sort((left, right) => left.field.localeCompare(right.field))
      .map((relation) => ({
        field: relation.field,
        type: relation.type,
        relatedCollection: relation.relatedCollection,
        relatedField: relation.relatedField,
        ...(relation.junctionCollection ? { junctionCollection: relation.junctionCollection } : {}),
      })),
    uniqueConstraints: collection.uniqueConstraints
      .slice()
      .sort((left, right) => left.fields.join(",").localeCompare(right.fields.join(","))),
  };
}

function relationString(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join(" <-> ");
}

function requireCollection(schema: Schema, collectionName: string): Collection {
  const collection = schema.collections.get(collectionName);
  if (!collection) {
    throw new Error(`Unknown collection "${collectionName}".`);
  }
  return collection;
}
