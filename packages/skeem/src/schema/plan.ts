import { diffSchemaDocuments } from "./diff.js";
import { toRelationInput } from "./m2m.js";
import type {
  SchemaDiffChange,
  SchemaPlanEntry,
  SchemaPlanSummary,
} from "../types/index.js";
import type { SchemaDocument } from "./serialization.js";

export function buildDefinePlan(
  fileDocument: SchemaDocument,
  liveDocument: SchemaDocument,
): {
  plan: SchemaPlanEntry[];
  summary: SchemaPlanSummary;
  diff: ReturnType<typeof diffSchemaDocuments>;
} {
  const diff = diffSchemaDocuments(fileDocument, liveDocument, "define");
  const createCollections: SchemaPlanEntry[] = [];
  const createFields: SchemaPlanEntry[] = [];
  const updateFields: SchemaPlanEntry[] = [];
  const createRelations: SchemaPlanEntry[] = [];
  const createManyToManyRelations: SchemaPlanEntry[] = [];
  const destructive: SchemaPlanEntry[] = [];
  const blocked: SchemaPlanEntry[] = [];

  for (const change of diff.changes) {
    const entry = changeToPlanEntry(change, fileDocument, liveDocument);
    if (!entry) {
      continue;
    }

    switch (entry.action) {
      case "create_collection":
        createCollections.push(entry);
        break;
      case "create_field":
        createFields.push(entry);
        break;
      case "update_field":
        updateFields.push(entry);
        break;
      case "create_relation":
        createRelations.push(entry);
        break;
      case "create_many_to_many_relation":
        createManyToManyRelations.push(entry);
        break;
      default:
        if (entry.executable) {
          destructive.push(entry);
        } else {
          blocked.push(entry);
        }
        break;
    }
  }

  const plan = dedupeManyToMany([
    ...sortByCollection(createCollections),
    ...sortByField(createFields),
    ...sortByField(updateFields),
    ...sortByField(createRelations),
    ...sortBySummary(createManyToManyRelations),
    ...sortDestructive(destructive),
    ...sortBySummary(blocked),
  ]);

  return {
    plan,
    summary: summarizePlan(plan),
    diff,
  };
}

// A junction appears on both collections' relation maps, so the two sides
// produce two equivalent m2m entries. Keep the first per junction collection.
function dedupeManyToMany(plan: SchemaPlanEntry[]): SchemaPlanEntry[] {
  const seen = new Set<string>();
  const result: SchemaPlanEntry[] = [];

  for (const entry of plan) {
    if (entry.action === "create_many_to_many_relation" || entry.action === "remove_many_to_many_relation") {
      const relation = entry.details?.relation as { junctionCollection?: string } | undefined;
      const key = `${entry.action}:${relation?.junctionCollection ?? entry.summary}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    result.push(entry);
  }

  return result;
}

function changeToPlanEntry(
  change: SchemaDiffChange,
  fileDocument: SchemaDocument,
  liveDocument: SchemaDocument,
): SchemaPlanEntry | undefined {
  switch (change.scope) {
    case "collection":
      if (change.status === "only_in_file") {
        const collection = fileDocument.collections[change.name];
        if (!collection) {
          return undefined;
        }
        return {
          action: "create_collection",
          status: "planned",
          collection: change.name,
          destructive: false,
          executable: true,
          summary: `create collection: ${change.name} (${Object.keys(collection.fields).length} fields)`,
          details: {
            fields: Object.entries(collection.fields).map(([name, field]) => ({ name, ...field })),
          },
        };
      }

      if (change.status === "only_in_live") {
        return executableEntry({
          action: "remove_collection",
          collection: change.name,
          summary: `remove collection: ${change.name}`,
          destructive: true,
        });
      }
      return undefined;

    case "field":
      if (!change.collection) {
        return undefined;
      }

      if (change.status === "only_in_file") {
        const field = fileDocument.collections[change.collection]?.fields[change.name];
        if (!field) {
          return undefined;
        }
        return {
          action: "create_field",
          status: "planned",
          collection: change.collection,
          field: change.name,
          destructive: false,
          executable: true,
          summary: `create field: ${change.collection}.${change.name} (${field.type})`,
          details: { field: { name: change.name, ...field } },
        };
      }

      if (change.status === "only_in_live") {
        return executableEntry({
          action: "remove_field",
          collection: change.collection,
          field: change.name,
          summary: `remove field: ${change.collection}.${change.name}`,
          destructive: true,
        });
      }

      const fileField = fileDocument.collections[change.collection]?.fields[change.name];
      const liveField = liveDocument.collections[change.collection]?.fields[change.name];
      if (!fileField || !liveField) {
        return undefined;
      }

      const classification = classifyFieldUpdate(fileField, liveField);
      if (!classification.executable) {
        return blockedEntry({
          action: "update_field",
          collection: change.collection,
          field: change.name,
          summary: `update field: ${change.collection}.${change.name}`,
          reason: classification.reason ?? "Field update is not executable yet.",
          destructive: classification.destructive,
          details: {
            field: {
              name: change.name,
              ...fileField,
              ...(classification.clearDefault ? { clearDefault: true } : {}),
            },
          },
        });
      }

      return {
        action: "update_field",
        status: "planned",
        collection: change.collection,
        field: change.name,
        destructive: classification.destructive,
        executable: true,
        summary: `update field: ${change.collection}.${change.name}`,
        details: {
          field: {
            name: change.name,
            ...fileField,
            ...(classification.clearDefault ? { clearDefault: true } : {}),
          },
        },
      };

    case "relation":
      if (!change.collection) {
        return undefined;
      }

      if (change.status === "only_in_file") {
        const relation = fileDocument.collections[change.collection]?.relations?.[change.name];
        if (!relation) {
          return undefined;
        }
        if (relation.type === "m2m") {
          return executableEntry({
            action: "create_many_to_many_relation",
            collection: change.collection,
            field: change.name,
            summary: `create junction: ${change.collection}.${change.name} <-> ${relation.collection}`,
            destructive: false,
            details: { relation: toRelationInput(change.collection, change.name, relation) },
          });
        }
        if (relation.type === "m2o") {
          return executableEntry({
            action: "create_relation",
            collection: change.collection,
            field: change.name,
            summary: `create relation: ${change.collection}.${change.name} -> ${relation.collection} (${relation.type})`,
            destructive: false,
            details: { relation: toRelationInput(change.collection, change.name, relation) },
          });
        }
        return blockedEntry({
          action: "create_relation",
          collection: change.collection,
          field: change.name,
          summary: `create relation: ${change.collection}.${change.name} -> ${relation.collection} (${relation.type})`,
          reason: "Only m2o and m2m relations can be created from a schema document.",
          destructive: false,
        });
      }

      if (change.status === "only_in_live") {
        const liveRelation = liveDocument.collections[change.collection]?.relations?.[change.name];
        if (liveRelation?.type === "m2m") {
          return executableEntry({
            action: "remove_many_to_many_relation",
            collection: change.collection,
            field: change.name,
            summary: `remove junction: ${change.collection}.${change.name} <-> ${liveRelation.collection}`,
            destructive: true,
            details: { relation: toRelationInput(change.collection, change.name, liveRelation) },
          });
        }
        return executableEntry({
          action: "remove_relation",
          collection: change.collection,
          field: change.name,
          summary: `remove relation: ${change.collection}.${change.name}`,
          destructive: true,
          ...(liveRelation
            ? { details: { relation: toRelationInput(change.collection, change.name, liveRelation) } }
            : {}),
        });
      }

      const fileRelation = fileDocument.collections[change.collection]?.relations?.[change.name];
      const liveRelation = liveDocument.collections[change.collection]?.relations?.[change.name];
      if (!fileRelation || !liveRelation) {
        return undefined;
      }

      if (fileRelation.type === "m2m" || liveRelation.type === "m2m") {
        return blockedEntry({
          action: "update_relation",
          collection: change.collection,
          field: change.name,
          summary: `update relation: ${change.collection}.${change.name}`,
          reason: "Many-to-many structural changes require manual remove and recreate.",
          destructive: true,
        });
      }

      return executableEntry({
        action: "update_relation",
        collection: change.collection,
        field: change.name,
        summary: `update relation: ${change.collection}.${change.name}`,
        destructive: true,
        details: {
          relation: {
            from: toRelationInput(change.collection, change.name, liveRelation),
            to: toRelationInput(change.collection, change.name, fileRelation),
          },
        },
      });

    case "unique_constraint":
      if (!change.collection) {
        return undefined;
      }

      if (change.status === "only_in_file") {
        return blockedEntry({
          action: "create_unique_constraint",
          collection: change.collection,
          summary: `create unique constraint: ${change.collection} (${change.name})`,
          reason: "Directus REST schema APIs do not expose composite unique constraints directly.",
          destructive: false,
        });
      }

      return blockedEntry({
        action: "remove_unique_constraint",
        collection: change.collection,
        summary: `remove unique constraint: ${change.collection} (${change.name})`,
        reason: "Directus REST schema APIs do not expose composite unique constraints directly.",
        destructive: true,
      });
  }
}

function classifyFieldUpdate(
  fileField: SchemaDocument["collections"][string]["fields"][string],
  liveField: SchemaDocument["collections"][string]["fields"][string],
): {
  executable: boolean;
  destructive: boolean;
  clearDefault?: boolean;
  reason?: string;
} {
  if (fileField.type !== liveField.type) {
    return {
      executable: false,
      destructive: true,
      reason: "Field type changes are not executable yet.",
    };
  }

  const fileHasEnum = Array.isArray(fileField.enum) && fileField.enum.length > 0;
  const liveHasEnum = Array.isArray(liveField.enum) && liveField.enum.length > 0;
  if (fileHasEnum || liveHasEnum) {
    return {
      executable: false,
      destructive: false,
      reason: "Enum schema updates are not executable yet.",
    };
  }

  const liveHasDefault = Object.prototype.hasOwnProperty.call(liveField, "default");
  const fileHasDefault = Object.prototype.hasOwnProperty.call(fileField, "default");

  return {
    executable: true,
    destructive: false,
    ...(liveHasDefault && !fileHasDefault ? { clearDefault: true } : {}),
  };
}

function blockedEntry(input: {
  action: SchemaPlanEntry["action"];
  collection?: string;
  field?: string;
  summary: string;
  reason: string;
  destructive: boolean;
  details?: Record<string, unknown>;
}): SchemaPlanEntry {
  return {
    action: input.action,
    status: "planned",
    collection: input.collection,
    field: input.field,
    destructive: input.destructive,
    executable: false,
    summary: input.summary,
    reason: input.reason,
    ...(input.details ? { details: input.details } : {}),
  };
}

function executableEntry(input: {
  action: SchemaPlanEntry["action"];
  collection?: string;
  field?: string;
  summary: string;
  destructive: boolean;
  details?: Record<string, unknown>;
}): SchemaPlanEntry {
  return {
    action: input.action,
    status: "planned",
    collection: input.collection,
    field: input.field,
    destructive: input.destructive,
    executable: true,
    summary: input.summary,
    ...(input.details ? { details: input.details } : {}),
  };
}

function summarizePlan(plan: SchemaPlanEntry[]): SchemaPlanSummary {
  return plan.reduce<SchemaPlanSummary>((summary, entry) => ({
    total: summary.total + 1,
    executable: summary.executable + (entry.executable ? 1 : 0),
    destructive: summary.destructive + (entry.destructive ? 1 : 0),
    blocked: summary.blocked + (!entry.executable ? 1 : 0),
    applied: summary.applied + (entry.status === "applied" ? 1 : 0),
    skipped: summary.skipped + (entry.status === "skipped" ? 1 : 0),
  }), {
    total: 0,
    executable: 0,
    destructive: 0,
    blocked: 0,
    applied: 0,
    skipped: 0,
  });
}

function sortByCollection(entries: SchemaPlanEntry[]): SchemaPlanEntry[] {
  return entries.slice().sort((left, right) => (left.collection ?? "").localeCompare(right.collection ?? ""));
}

function sortByField(entries: SchemaPlanEntry[]): SchemaPlanEntry[] {
  return entries.slice().sort((left, right) => {
    const collectionCompare = (left.collection ?? "").localeCompare(right.collection ?? "");
    if (collectionCompare !== 0) {
      return collectionCompare;
    }
    return (left.field ?? "").localeCompare(right.field ?? "");
  });
}

function sortDestructive(entries: SchemaPlanEntry[]): SchemaPlanEntry[] {
  const priority: Record<SchemaPlanEntry["action"], number> = {
    create_collection: 0,
    create_field: 0,
    update_field: 0,
    create_relation: 0,
    create_unique_constraint: 0,
    create_many_to_many_relation: 0,
    remove_collection: 3,
    remove_field: 2,
    remove_relation: 1,
    remove_many_to_many_relation: 1,
    remove_unique_constraint: 1,
    update_relation: 1,
  };

  return entries.slice().sort((left, right) => {
    const priorityCompare = priority[left.action] - priority[right.action];
    if (priorityCompare !== 0) {
      return priorityCompare;
    }
    return left.summary.localeCompare(right.summary);
  });
}

function sortBySummary(entries: SchemaPlanEntry[]): SchemaPlanEntry[] {
  return entries.slice().sort((left, right) => left.summary.localeCompare(right.summary));
}
