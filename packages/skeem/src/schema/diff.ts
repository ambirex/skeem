import { isDeepStrictEqual } from "node:util";

import type {
  DiffDirection,
  SchemaDiffChange,
  SchemaDiffResolution,
  SchemaDiffResult,
  SchemaDiffStatus,
} from "../types/index.js";
import type { SchemaDocument } from "./serialization.js";

type FieldDefinition = SchemaDocument["collections"][string]["fields"][string];
type RelationDefinition = NonNullable<SchemaDocument["collections"][string]["relations"]>[string];

export function diffSchemaDocuments(
  fileDocument: SchemaDocument,
  liveDocument: SchemaDocument,
  direction: DiffDirection,
): Omit<SchemaDiffResult, "path"> {
  const changes: SchemaDiffChange[] = [];
  const matches: string[] = [];
  const collectionNames = unionKeys(fileDocument.collections, liveDocument.collections);

  for (const collectionName of collectionNames) {
    const fileCollection = fileDocument.collections[collectionName];
    const liveCollection = liveDocument.collections[collectionName];

    if (fileCollection && !liveCollection) {
      changes.push({
        scope: "collection",
        name: collectionName,
        status: "only_in_file",
        message: `file declares collection "${collectionName}" (not in live)`,
        resolution: resolutionFor("only_in_file", direction),
        fileValue: fileCollection,
      });
      continue;
    }

    if (!fileCollection && liveCollection) {
      changes.push({
        scope: "collection",
        name: collectionName,
        status: "only_in_live",
        message: `live has collection "${collectionName}" (not in file)`,
        resolution: resolutionFor("only_in_live", direction),
        liveValue: liveCollection,
      });
      continue;
    }

    if (!fileCollection || !liveCollection) {
      continue;
    }

    const beforeCollection = changes.length;
    compareFields(collectionName, fileCollection.fields, liveCollection.fields, direction, changes);
    compareRelations(collectionName, fileCollection.relations, liveCollection.relations, direction, changes);
    compareUniqueConstraints(
      collectionName,
      fileCollection.uniqueConstraints ?? [],
      liveCollection.uniqueConstraints ?? [],
      direction,
      changes,
    );

    if (changes.length === beforeCollection) {
      matches.push(`${collectionName}: match`);
    }
  }

  compareManyToManyRelations(fileDocument.relations ?? [], liveDocument.relations ?? [], direction, changes);

  return {
    direction,
    changes,
    matches,
    summary: summarize(changes, matches.length),
  };
}

function compareFields(
  collectionName: string,
  fileFields: SchemaDocument["collections"][string]["fields"],
  liveFields: SchemaDocument["collections"][string]["fields"],
  direction: DiffDirection,
  changes: SchemaDiffChange[],
): void {
  for (const fieldName of unionKeys(fileFields, liveFields)) {
    const fileField = fileFields[fieldName];
    const liveField = liveFields[fieldName];

    if (fileField && !liveField) {
      changes.push({
        scope: "field",
        collection: collectionName,
        name: fieldName,
        status: "only_in_file",
        message: `${collectionName}: file declares field "${fieldName}" (${fileField.type})`,
        resolution: resolutionFor("only_in_file", direction),
        fileValue: normalizeField(fileField),
      });
      continue;
    }

    if (!fileField && liveField) {
      changes.push({
        scope: "field",
        collection: collectionName,
        name: fieldName,
        status: "only_in_live",
        message: `${collectionName}: live has extra field "${fieldName}" (${liveField.type})`,
        resolution: resolutionFor("only_in_live", direction),
        liveValue: normalizeField(liveField),
      });
      continue;
    }

    if (!fileField || !liveField) {
      continue;
    }

    const normalizedFileField = normalizeField(fileField);
    const normalizedLiveField = normalizeField(liveField);
    if (isDeepStrictEqual(normalizedFileField, normalizedLiveField)) {
      continue;
    }

    changes.push({
      scope: "field",
      collection: collectionName,
      name: fieldName,
      status: "mismatch",
      message: `${collectionName}: field "${fieldName}" differs: ${describeFieldDifference(fileField, liveField)}`,
      resolution: resolutionFor("mismatch", direction),
      fileValue: normalizedFileField,
      liveValue: normalizedLiveField,
    });
  }
}

function compareRelations(
  collectionName: string,
  fileRelations: SchemaDocument["collections"][string]["relations"] | undefined,
  liveRelations: SchemaDocument["collections"][string]["relations"] | undefined,
  direction: DiffDirection,
  changes: SchemaDiffChange[],
): void {
  const fileValue = fileRelations ?? {};
  const liveValue = liveRelations ?? {};

  for (const relationField of unionKeys(fileValue, liveValue)) {
    const fileRelation = fileValue[relationField];
    const liveRelation = liveValue[relationField];

    if (fileRelation && !liveRelation) {
      changes.push({
        scope: "relation",
        collection: collectionName,
        name: relationField,
        status: "only_in_file",
        message: `${collectionName}: file declares relation "${relationField}" -> ${formatRelation(fileRelation)}`,
        resolution: resolutionFor("only_in_file", direction),
        fileValue: fileRelation,
      });
      continue;
    }

    if (!fileRelation && liveRelation) {
      changes.push({
        scope: "relation",
        collection: collectionName,
        name: relationField,
        status: "only_in_live",
        message: `${collectionName}: live has extra relation "${relationField}" -> ${formatRelation(liveRelation)}`,
        resolution: resolutionFor("only_in_live", direction),
        liveValue: liveRelation,
      });
      continue;
    }

    if (!fileRelation || !liveRelation || isDeepStrictEqual(fileRelation, liveRelation)) {
      continue;
    }

    changes.push({
      scope: "relation",
      collection: collectionName,
      name: relationField,
      status: "mismatch",
      message: `${collectionName}: relation "${relationField}" differs: file=${formatRelation(fileRelation)}, live=${formatRelation(liveRelation)}`,
      resolution: resolutionFor("mismatch", direction),
      fileValue: fileRelation,
      liveValue: liveRelation,
    });
  }
}

function compareUniqueConstraints(
  collectionName: string,
  fileConstraints: string[][],
  liveConstraints: string[][],
  direction: DiffDirection,
  changes: SchemaDiffChange[],
): void {
  const fileMap = new Map(fileConstraints.map((fields) => [constraintSignature(fields), fields]));
  const liveMap = new Map(liveConstraints.map((fields) => [constraintSignature(fields), fields]));

  for (const signature of unionKeys(fileMap, liveMap)) {
    const fileConstraint = fileMap.get(signature);
    const liveConstraint = liveMap.get(signature);

    if (fileConstraint && !liveConstraint) {
      changes.push({
        scope: "unique_constraint",
        collection: collectionName,
        name: signature,
        status: "only_in_file",
        message: `${collectionName}: file declares unique constraint (${fileConstraint.join(", ")})`,
        resolution: resolutionFor("only_in_file", direction),
        fileValue: fileConstraint,
      });
      continue;
    }

    if (!fileConstraint && liveConstraint) {
      changes.push({
        scope: "unique_constraint",
        collection: collectionName,
        name: signature,
        status: "only_in_live",
        message: `${collectionName}: live has extra unique constraint (${liveConstraint.join(", ")})`,
        resolution: resolutionFor("only_in_live", direction),
        liveValue: liveConstraint,
      });
    }
  }
}

function compareManyToManyRelations(
  fileRelations: string[],
  liveRelations: string[],
  direction: DiffDirection,
  changes: SchemaDiffChange[],
): void {
  const fileSet = new Set(fileRelations);
  const liveSet = new Set(liveRelations);

  for (const relation of Array.from(new Set([...fileRelations, ...liveRelations])).sort((left, right) => left.localeCompare(right))) {
    if (fileSet.has(relation) && !liveSet.has(relation)) {
      changes.push({
        scope: "many_to_many_relation",
        name: relation,
        status: "only_in_file",
        message: `file declares many-to-many relation "${relation}" (not in live)`,
        resolution: resolutionFor("only_in_file", direction),
        fileValue: relation,
      });
      continue;
    }

    if (!fileSet.has(relation) && liveSet.has(relation)) {
      changes.push({
        scope: "many_to_many_relation",
        name: relation,
        status: "only_in_live",
        message: `live has many-to-many relation "${relation}" (not in file)`,
        resolution: resolutionFor("only_in_live", direction),
        liveValue: relation,
      });
    }
  }
}

function unionKeys(
  left: Record<string, unknown> | Map<string, unknown>,
  right: Record<string, unknown> | Map<string, unknown>,
): string[] {
  const leftKeys = left instanceof Map ? Array.from(left.keys()) : Object.keys(left);
  const rightKeys = right instanceof Map ? Array.from(right.keys()) : Object.keys(right);
  return Array.from(new Set([...leftKeys, ...rightKeys])).sort((a, b) => a.localeCompare(b));
}

function normalizeField(field: FieldDefinition): Record<string, unknown> {
  const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");
  return {
    type: field.type,
    required: field.required === true,
    unique: field.unique === true,
    hasDefault,
    ...(hasDefault ? { default: field.default } : {}),
    ...(field.enum && field.enum.length > 0 ? { enum: [...field.enum].sort((left, right) => left.localeCompare(right)) } : {}),
  };
}

function describeFieldDifference(fileField: FieldDefinition, liveField: FieldDefinition): string {
  const parts: string[] = [];

  if (fileField.type !== liveField.type) {
    parts.push(`type differs: file=${formatValue(fileField.type)}, live=${formatValue(liveField.type)}`);
  }
  if (Boolean(fileField.required) !== Boolean(liveField.required)) {
    parts.push(`required differs: file=${formatValue(Boolean(fileField.required))}, live=${formatValue(Boolean(liveField.required))}`);
  }
  if (Boolean(fileField.unique) !== Boolean(liveField.unique)) {
    parts.push(`unique differs: file=${formatValue(Boolean(fileField.unique))}, live=${formatValue(Boolean(liveField.unique))}`);
  }

  const fileHasDefault = Object.prototype.hasOwnProperty.call(fileField, "default");
  const liveHasDefault = Object.prototype.hasOwnProperty.call(liveField, "default");
  if (fileHasDefault !== liveHasDefault || !isDeepStrictEqual(fileField.default, liveField.default)) {
    parts.push(`default differs: file=${formatMaybeValue(fileHasDefault, fileField.default)}, live=${formatMaybeValue(liveHasDefault, liveField.default)}`);
  }

  const fileEnum = fileField.enum ? [...fileField.enum].sort((left, right) => left.localeCompare(right)) : undefined;
  const liveEnum = liveField.enum ? [...liveField.enum].sort((left, right) => left.localeCompare(right)) : undefined;
  if (!isDeepStrictEqual(fileEnum, liveEnum)) {
    parts.push(`enum differs: file=${formatValue(fileEnum ?? [])}, live=${formatValue(liveEnum ?? [])}`);
  }

  return parts.join("; ");
}

function formatRelation(relation: RelationDefinition): string {
  return `${relation.collection} (${relation.type})`;
}

function formatMaybeValue(hasValue: boolean, value: unknown): string {
  return hasValue ? formatValue(value) : "(unset)";
}

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

function constraintSignature(fields: string[]): string {
  return [...fields].sort((left, right) => left.localeCompare(right)).join(",");
}

function resolutionFor(status: SchemaDiffStatus, direction: DiffDirection): SchemaDiffResolution {
  if (direction === "define") {
    switch (status) {
      case "only_in_file":
        return "create_in_live";
      case "only_in_live":
        return "remove_from_live";
      case "mismatch":
        return "update_live";
    }
  }

  switch (status) {
    case "only_in_file":
      return "remove_from_file";
    case "only_in_live":
      return "create_in_file";
    case "mismatch":
      return "update_file";
  }
}

function summarize(changes: SchemaDiffChange[], matchCount: number): SchemaDiffResult["summary"] {
  let additions = 0;
  let removals = 0;
  let updates = 0;

  for (const change of changes) {
    switch (change.resolution) {
      case "create_in_live":
      case "create_in_file":
        additions += 1;
        break;
      case "remove_from_live":
      case "remove_from_file":
        removals += 1;
        break;
      case "update_live":
      case "update_file":
        updates += 1;
        break;
    }
  }

  return {
    additions,
    removals,
    updates,
    matches: matchCount,
    totalChanges: changes.length,
  };
}
