import type { SchemaRelationInput } from "../types/index.js";
import type { SchemaDocument } from "./serialization.js";

type RelationDefinition = NonNullable<SchemaDocument["collections"][string]["relations"]>[string];

export interface M2mConvention {
  inverseField: string;
  junctionCollection: string;
  junctionField: string;
  inverseJunctionField: string;
}

/**
 * Default junction naming for a many-to-many relation. This mirrors the
 * fallbacks in `@skeems/directus` createManyToManyRelation
 * (makeJunctionCollectionName / makeJunctionFieldName / inverseField default),
 * so a schema document may omit any junction detail that matches the
 * convention and still round-trip cleanly.
 */
export function m2mConvention(collection: string, relatedCollection: string): M2mConvention {
  return {
    inverseField: collection,
    junctionCollection: [collection, relatedCollection].sort((a, b) => a.localeCompare(b)).join("_"),
    junctionField: `${collection}_id`,
    inverseJunctionField: `${relatedCollection}_id`,
  };
}

/**
 * Resolve a document relation entry into the full SchemaRelationInput an
 * adapter needs, filling any omitted m2m junction detail from the convention.
 */
export function toRelationInput(
  collection: string,
  field: string,
  relation: RelationDefinition,
): SchemaRelationInput {
  if (relation.type === "m2m") {
    const convention = m2mConvention(collection, relation.collection);
    return {
      collection,
      field,
      relatedCollection: relation.collection,
      type: "m2m",
      inverseField: relation.relatedField ?? convention.inverseField,
      junctionCollection: relation.junctionCollection ?? convention.junctionCollection,
      junctionField: relation.junctionField ?? convention.junctionField,
      inverseJunctionField: relation.inverseJunctionField ?? convention.inverseJunctionField,
    };
  }

  return {
    collection,
    field,
    relatedCollection: relation.collection,
    type: relation.type,
  };
}

/**
 * Canonical form of a relation for diffing. m2m junction detail is filled from
 * the convention so a minimal hand-written entry matches a fully-discovered
 * one when they describe the same junction.
 */
export function canonicalRelation(
  collection: string,
  relation: RelationDefinition,
): Record<string, unknown> {
  if (relation.type === "m2m") {
    const convention = m2mConvention(collection, relation.collection);
    return {
      collection: relation.collection,
      type: relation.type,
      relatedField: relation.relatedField ?? convention.inverseField,
      junctionCollection: relation.junctionCollection ?? convention.junctionCollection,
      junctionField: relation.junctionField ?? convention.junctionField,
      inverseJunctionField: relation.inverseJunctionField ?? convention.inverseJunctionField,
    };
  }

  return {
    collection: relation.collection,
    type: relation.type,
  };
}
