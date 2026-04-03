import { RelationNotFoundError } from "../errors/index.js";
import type { Collection, Relation, ResolvedConfig, Schema } from "../types/index.js";

export function resolveCollectionName(schema: Schema, input: string, config: ResolvedConfig): string {
  const aliased = config.schema.aliases[input] ?? input;
  if (schema.collections.has(aliased)) {
    return aliased;
  }

  const caseInsensitive = Array.from(schema.collections.keys()).find((name) => name.toLowerCase() === aliased.toLowerCase());
  if (caseInsensitive) {
    return caseInsensitive;
  }

  return aliased;
}

export function filterCollections(schema: Schema, config: ResolvedConfig): Collection[] {
  return Array.from(schema.collections.values()).filter((collection) => {
    return !config.schema.exclude.some((pattern) => matchesGlob(collection.name, pattern));
  });
}

export function resolveRelation(collection: Collection, segment: string): Relation {
  const normalized = segment.toLowerCase();
  const matches = collection.relations.filter((relation) => {
    const candidates = new Set<string>([
      relation.field.toLowerCase(),
      stripIdSuffix(relation.field).toLowerCase(),
      relation.relatedCollection.toLowerCase(),
      singularize(relation.relatedCollection).toLowerCase(),
    ]);
    return candidates.has(normalized);
  });

  if (matches.length === 1) {
    return matches[0]!;
  }

  throw new RelationNotFoundError(collection.name, segment);
}

export function resolveExpandPaths(schema: Schema, collectionName: string, expand: string[]): string[] {
  const collection = requireCollection(schema, collectionName);
  return expand.map((path) => {
    const segments = path.split(".");
    let currentCollection = collection;
    const resolvedSegments: string[] = [];

    for (const segment of segments) {
      const relation = resolveRelation(currentCollection, segment);
      resolvedSegments.push(relation.field);
      currentCollection = requireCollection(schema, relation.relatedCollection);
    }

    return resolvedSegments.join(".");
  });
}

export function requireCollection(schema: Schema, collectionName: string): Collection {
  const collection = schema.collections.get(collectionName);
  if (!collection) {
    throw new Error(`Unknown collection "${collectionName}".`);
  }
  return collection;
}

function stripIdSuffix(field: string): string {
  return field.endsWith("_id") ? field.slice(0, -3) : field;
}

function singularize(value: string): string {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s")) {
    return value.slice(0, -1);
  }
  return value;
}

function matchesGlob(input: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(input);
}
