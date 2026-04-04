import { AmbiguousError, UsageError, ValidationError } from "../errors/index.js";
import { parseFilterAssignment } from "./values.js";
import type {
  Collection,
  EntityRecord,
  ExecLinkTargetInput,
  Filter,
  InputNode,
  PrimaryKey,
  Relation,
} from "../types/index.js";

export type UpsertDecision =
  | {
      kind: "create";
    }
  | {
      kind: "update";
      record: EntityRecord;
    };

export interface ParsedRecordReference {
  collectionInput: string;
  id: PrimaryKey;
}

export type ParsedLinkTarget =
  | {
      kind: "record";
      id: PrimaryKey;
      collectionInput?: string;
    }
  | {
      kind: "resolve";
      filter: Filter;
      collectionInput?: string;
    };

export interface RelationMutationPlan {
  kind: "m2o" | "m2m";
  update?: {
    field: string;
    value: PrimaryKey | null;
  };
  junction?: {
    collection: string;
    data: Record<string, PrimaryKey>;
    filter: Filter;
  };
}

export function resolveUpsertDecision(collection: Collection, match: Filter, records: EntityRecord[]): UpsertDecision {
  if (records.length === 0) {
    return { kind: "create" };
  }

  if (records.length > 1) {
    throw new AmbiguousError(collection.name, match, records.length);
  }

  return {
    kind: "update",
    record: records[0]!,
  };
}

export function mergeUpsertCreateNode(node: InputNode, match: Filter, collectionName: string): InputNode {
  const fields = { ...node.fields };

  for (const [field, value] of Object.entries(match)) {
    if (node.children[field]) {
      throw new UsageError(`Cannot use --match "${field}" together with nested relation input on "${collectionName}".`, {
        field,
      });
    }

    if (Object.prototype.hasOwnProperty.call(fields, field) && fields[field] !== value) {
      throw new ValidationError(collectionName, field, `Upsert match for "${field}" conflicts with the requested write value.`);
    }

    fields[field] = value;
  }

  return {
    fields,
    children: { ...node.children },
    ...(node.selector ? { selector: node.selector } : {}),
  };
}

export function mergeUpsertCreateData(
  data: Record<string, unknown> | undefined,
  match: Filter,
  collectionName: string,
): Record<string, unknown> {
  const merged = { ...(data ?? {}) };

  for (const [field, value] of Object.entries(match)) {
    if (Object.prototype.hasOwnProperty.call(merged, field) && merged[field] !== value) {
      throw new ValidationError(collectionName, field, `Upsert match for "${field}" conflicts with the requested write value.`);
    }
    merged[field] = value;
  }

  return merged;
}

export function parseRecordReference(input: string, label: string): ParsedRecordReference {
  const separator = input.indexOf(":");
  if (separator <= 0 || separator === input.length - 1) {
    throw new UsageError(`Expected ${label} to use "collection:id" format.`);
  }

  return {
    collectionInput: input.slice(0, separator),
    id: parsePrimaryKeyLike(input.slice(separator + 1)),
  };
}

export function parseLinkArguments(relationOrTargetInput: string, maybeTargetInput?: string): {
  relationInput: string;
  target: ParsedLinkTarget;
} {
  if (maybeTargetInput !== undefined) {
    return {
      relationInput: relationOrTargetInput,
      target: parseLinkTarget(maybeTargetInput),
    };
  }

  const parsed = parseLinkTarget(relationOrTargetInput);
  if (parsed.kind === "record" && parsed.collectionInput) {
    return {
      relationInput: parsed.collectionInput,
      target: parsed,
    };
  }

  throw new UsageError("Link and unlink require an explicit relation when the target is not in collection:id form.");
}

export function parseLinkTarget(input: string): ParsedLinkTarget {
  if (input.startsWith("??")) {
    throw new UsageError("link and unlink do not support ?? resolve-or-create targets.");
  }

  if (input.startsWith("?")) {
    const assignment = parseFilterAssignment(input.slice(1));
    return {
      kind: "resolve",
      filter: { [assignment.field]: assignment.value },
    };
  }

  if (input.startsWith("@")) {
    return {
      kind: "record",
      id: parsePrimaryKeyLike(input.slice(1)),
    };
  }

  const separator = input.indexOf(":");
  if (separator > 0 && separator < input.length - 1) {
    return {
      kind: "record",
      collectionInput: input.slice(0, separator),
      id: parsePrimaryKeyLike(input.slice(separator + 1)),
    };
  }

  return {
    kind: "record",
    id: parsePrimaryKeyLike(input),
  };
}

export function parseExecLinkOperation(input: {
  relation?: string;
  target?: ExecLinkTargetInput;
}): {
  relationInput: string;
  target: ParsedLinkTarget;
} {
  const target = parseExecLinkTarget(input.target);
  const relationInput = input.relation ?? target.collectionInput;

  if (!relationInput) {
    throw new UsageError("Exec link/unlink operations require either relation or target.collection.");
  }

  return {
    relationInput,
    target,
  };
}

export function buildLinkMutationPlan(relation: Relation, sourceId: PrimaryKey, targetId: PrimaryKey): RelationMutationPlan {
  if (relation.type === "m2o") {
    return {
      kind: "m2o",
      update: {
        field: relation.field,
        value: targetId,
      },
    };
  }

  if (relation.type === "m2m") {
    const junction = requireJunctionMetadata(relation);
    return {
      kind: "m2m",
      junction: {
        collection: junction.junctionCollection,
        data: {
          [junction.localField]: sourceId,
          [junction.foreignField]: targetId,
        },
        filter: {
          [junction.localField]: sourceId,
          [junction.foreignField]: targetId,
        },
      },
    };
  }

  throw new UsageError(`Relation "${relation.field}" (${relation.type}) is not supported by link.`);
}

export function buildUnlinkMutationPlan(relation: Relation, sourceId: PrimaryKey, targetId: PrimaryKey): RelationMutationPlan {
  if (relation.type === "m2o") {
    return {
      kind: "m2o",
      update: {
        field: relation.field,
        value: null,
      },
    };
  }

  if (relation.type === "m2m") {
    const junction = requireJunctionMetadata(relation);
    return {
      kind: "m2m",
      junction: {
        collection: junction.junctionCollection,
        data: {
          [junction.localField]: sourceId,
          [junction.foreignField]: targetId,
        },
        filter: {
          [junction.localField]: sourceId,
          [junction.foreignField]: targetId,
        },
      },
    };
  }

  throw new UsageError(`Relation "${relation.field}" (${relation.type}) is not supported by unlink.`);
}

function parseExecLinkTarget(input: ExecLinkTargetInput | undefined): ParsedLinkTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UsageError("Exec link/unlink operations require a target object.");
  }

  const hasId = Object.prototype.hasOwnProperty.call(input, "id");
  const hasFilter = Object.prototype.hasOwnProperty.call(input, "filter");
  if (hasId === hasFilter) {
    throw new UsageError("Exec link/unlink target must include exactly one of target.id or target.filter.");
  }

  const collectionInput = typeof input.collection === "string" && input.collection.length > 0
    ? input.collection
    : undefined;

  if (hasId) {
    const id = input.id;
    if (typeof id !== "string" && typeof id !== "number") {
      throw new UsageError("Exec link/unlink target.id must be a string or number.");
    }
    return {
      kind: "record",
      id,
      ...(collectionInput ? { collectionInput } : {}),
    };
  }

  if (!input.filter || typeof input.filter !== "object" || Array.isArray(input.filter)) {
    throw new UsageError("Exec link/unlink target.filter must be an object.");
  }

  return {
    kind: "resolve",
    filter: input.filter as Filter,
    ...(collectionInput ? { collectionInput } : {}),
  };
}

function parsePrimaryKeyLike(value: string): PrimaryKey {
  return /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : value;
}

function requireJunctionMetadata(relation: Relation): {
  junctionCollection: string;
  localField: string;
  foreignField: string;
} {
  if (!relation.junctionCollection || !relation.junctionLocalField || !relation.junctionForeignField) {
    throw new UsageError(`Relation "${relation.field}" is missing junction metadata.`);
  }

  return {
    junctionCollection: relation.junctionCollection,
    localField: relation.junctionLocalField,
    foreignField: relation.junctionForeignField,
  };
}
