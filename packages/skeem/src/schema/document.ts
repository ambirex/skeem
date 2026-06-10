import { readFile } from "node:fs/promises";

import YAML from "yaml";

import { UsageError } from "../errors/index.js";
import type { FieldType, Relation } from "../types/index.js";
import type { SchemaDocument } from "./serialization.js";

const FIELD_TYPES = new Set<FieldType>([
  "string",
  "text",
  "integer",
  "float",
  "boolean",
  "datetime",
  "date",
  "json",
  "uuid",
  "csv",
]);

const RELATION_TYPES = new Set<Relation["type"]>(["m2o", "o2m", "m2m"]);

export async function loadSchemaDocument(filePath: string): Promise<SchemaDocument> {
  const source = await readFile(filePath, "utf8");
  return parseSchemaDocument(source);
}

export function parseSchemaDocument(source: string): SchemaDocument {
  const parsed = YAML.parse(source) as unknown;
  return normalizeSchemaDocument(parsed);
}

export function normalizeSchemaDocument(input: unknown): SchemaDocument {
  const document = expectRecord(input, "Schema document must be an object.");
  const collectionsInput = expectRecord(document.collections, 'Schema document must include a "collections" object.');
  const collectionNames = Object.keys(collectionsInput).sort((left, right) => left.localeCompare(right));
  const collections = Object.fromEntries(collectionNames.map((collectionName) => {
    const collection = expectRecord(collectionsInput[collectionName], `Collection "${collectionName}" must be an object.`);
    const fieldsInput = expectRecord(collection.fields, `Collection "${collectionName}" must define a "fields" object.`);
    const fieldNames = Object.keys(fieldsInput).sort((left, right) => left.localeCompare(right));
    const fields = Object.fromEntries(fieldNames.map((fieldName) => [
      fieldName,
      normalizeFieldDefinition(collectionName, fieldName, fieldsInput[fieldName]),
    ]));

    const relationsInput = collection.relations === undefined
      ? undefined
      : expectRecord(collection.relations, `Collection "${collectionName}" relations must be an object.`);
    const relationNames = relationsInput
      ? Object.keys(relationsInput).sort((left, right) => left.localeCompare(right))
      : [];
    const relations = relationsInput
      ? Object.fromEntries(relationNames.map((fieldName) => [
        fieldName,
        normalizeRelationDefinition(collectionName, fieldName, relationsInput[fieldName]),
      ]))
      : undefined;

    const uniqueConstraints = collection.uniqueConstraints === undefined
      ? undefined
      : normalizeUniqueConstraints(collection.uniqueConstraints, collectionName);

    return [
      collectionName,
      {
        fields,
        ...(relations && Object.keys(relations).length > 0 ? { relations } : {}),
        ...(uniqueConstraints && uniqueConstraints.length > 0 ? { uniqueConstraints } : {}),
      },
    ];
  }));

  return {
    name: typeof document.name === "string" ? document.name : "declared-schema",
    collections,
  };
}

function normalizeFieldDefinition(
  collectionName: string,
  fieldName: string,
  input: unknown,
): SchemaDocument["collections"][string]["fields"][string] {
  const field = expectRecord(input, `Field "${collectionName}.${fieldName}" must be an object.`);
  const type = expectString(field.type, `Field "${collectionName}.${fieldName}" must declare a valid type.`);
  if (!FIELD_TYPES.has(type as FieldType)) {
    throw new UsageError(`Field "${collectionName}.${fieldName}" uses unsupported type "${type}".`);
  }

  const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");
  const enumValues = field.enum === undefined
    ? undefined
    : normalizeStringArray(field.enum, `Field "${collectionName}.${fieldName}" enum must be an array of strings.`);

  return {
    type: type as FieldType,
    ...(field.required === true ? { required: true } : {}),
    ...(field.unique === true ? { unique: true } : {}),
    ...(hasDefault ? { default: field.default } : {}),
    ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
  };
}

function normalizeRelationDefinition(
  collectionName: string,
  fieldName: string,
  input: unknown,
): NonNullable<SchemaDocument["collections"][string]["relations"]>[string] {
  const relation = expectRecord(input, `Relation "${collectionName}.${fieldName}" must be an object.`);
  const relatedCollection = expectString(
    relation.collection,
    `Relation "${collectionName}.${fieldName}" must declare a target collection.`,
  );
  const type = expectString(relation.type, `Relation "${collectionName}.${fieldName}" must declare a relation type.`);
  if (!RELATION_TYPES.has(type as Relation["type"])) {
    throw new UsageError(`Relation "${collectionName}.${fieldName}" uses unsupported type "${type}".`);
  }

  return {
    collection: relatedCollection,
    type: type as Relation["type"],
    ...optionalRelationField(collectionName, fieldName, "relatedField", relation.relatedField),
    ...optionalRelationField(collectionName, fieldName, "junctionCollection", relation.junctionCollection),
    ...optionalRelationField(collectionName, fieldName, "junctionField", relation.junctionField),
    ...optionalRelationField(collectionName, fieldName, "inverseJunctionField", relation.inverseJunctionField),
  };
}

function optionalRelationField(
  collectionName: string,
  fieldName: string,
  key: string,
  value: unknown,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  return {
    [key]: expectString(value, `Relation "${collectionName}.${fieldName}" ${key} must be a string.`),
  };
}

function normalizeUniqueConstraints(input: unknown, collectionName: string): string[][] {
  if (!Array.isArray(input)) {
    throw new UsageError(`Collection "${collectionName}" uniqueConstraints must be an array of field arrays.`);
  }

  return dedupeSortedArrays(
    input.map((value, index) => normalizeStringArray(
      value,
      `Unique constraint ${index + 1} on "${collectionName}" must be an array of field names.`,
    )),
  );
}

function normalizeStringArray(input: unknown, message: string): string[] {
  if (!Array.isArray(input) || input.some((value) => typeof value !== "string")) {
    throw new UsageError(message);
  }
  return [...input].sort((left, right) => left.localeCompare(right));
}

function dedupeSortedArrays(values: string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];

  for (const value of values) {
    const signature = value.join("\u0000");
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    result.push(value);
  }

  return result.sort((left, right) => left.join(",").localeCompare(right.join(",")));
}

function expectRecord(input: unknown, message: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UsageError(message);
  }
  return input as Record<string, unknown>;
}

function expectString(input: unknown, message: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new UsageError(message);
  }
  return input;
}
