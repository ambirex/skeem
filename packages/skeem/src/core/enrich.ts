import { SkemError, UsageError, ValidationError } from "../errors/index.js";
import { defaultAdapterUrl } from "./adapters.js";
import { parsePrimaryKeyLike } from "./data-verbs.js";
import { parseFilterAssignment } from "./values.js";
import type {
  AdapterConfig,
  Collection,
  EntityRecord,
  Field,
  Filter,
  InputNode,
  PrimaryKey,
  SourceConfigEntry,
} from "../types/index.js";

const ENRICH_GRAMMAR = 'Expected "<source>:<collection>:<id>" or "<source>:<collection>?<field>=<value>".';

/** Raw CLI input for an enrichment request, before any parsing. */
export interface EnrichInput {
  spec: string;
  map: string[];
}

export type ParsedEnrichSpec =
  | {
      kind: "id";
      source: string;
      collection: string;
      id: PrimaryKey;
      raw: string;
    }
  | {
      kind: "find";
      source: string;
      collection: string;
      filter: Filter;
      raw: string;
    };

export function parseEnrichSpec(raw: string): ParsedEnrichSpec {
  const sourceSeparator = raw.indexOf(":");
  if (sourceSeparator <= 0) {
    throw new UsageError(`Cannot parse --enrich "${raw}". ${ENRICH_GRAMMAR}`);
  }

  const source = raw.slice(0, sourceSeparator);
  const remainder = raw.slice(sourceSeparator + 1);

  // Whichever of ":" / "?" appears first decides the form, so ids may contain
  // ":" or "?" (CrossRef DOIs) and find values may contain ":".
  const idSeparator = remainder.indexOf(":");
  const findSeparator = remainder.indexOf("?");
  const isIdForm = idSeparator !== -1 && (findSeparator === -1 || idSeparator < findSeparator);

  if (isIdForm) {
    const collection = remainder.slice(0, idSeparator);
    const id = remainder.slice(idSeparator + 1);
    if (!collection || !id) {
      throw new UsageError(`Cannot parse --enrich "${raw}". ${ENRICH_GRAMMAR}`);
    }
    return { kind: "id", source, collection, id: parsePrimaryKeyLike(id), raw };
  }

  if (findSeparator === -1) {
    throw new UsageError(`Cannot parse --enrich "${raw}". ${ENRICH_GRAMMAR}`);
  }

  const collection = remainder.slice(0, findSeparator);
  const query = remainder.slice(findSeparator + 1);
  if (!collection || !query.includes("=") || query.startsWith("=")) {
    throw new UsageError(`Cannot parse --enrich "${raw}". ${ENRICH_GRAMMAR}`);
  }

  const assignment = parseFilterAssignment(query);
  return {
    kind: "find",
    source,
    collection,
    filter: { [assignment.field]: assignment.value },
    raw,
  };
}

export interface ParsedMapEntry {
  sourcePath: string;
  targetField: string;
  raw: string;
}

export function parseMapEntries(raw: string[]): ParsedMapEntry[] {
  const entries: ParsedMapEntry[] = [];
  const seenTargets = new Set<string>();

  for (const item of raw) {
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      throw new UsageError(`Cannot parse --map "${item}". Expected "<sourcePath>=<targetField>".`);
    }

    const sourcePath = item.slice(0, separator);
    const targetField = item.slice(separator + 1);
    if (targetField.includes(".")) {
      throw new UsageError(`--map target "${targetField}" must be a top-level field on the target collection.`);
    }
    if (seenTargets.has(targetField)) {
      throw new UsageError(`--map sets target "${targetField}" more than once.`);
    }

    seenTargets.add(targetField);
    entries.push({ sourcePath, targetField, raw: item });
  }

  return entries;
}

export function resolveSourceEntry(
  sources: Record<string, SourceConfigEntry>,
  name: string,
): { adapter: string; connection: AdapterConfig } {
  const entry = sources[name];
  if (!entry) {
    const configured = Object.keys(sources);
    throw new UsageError(
      configured.length > 0
        ? `Unknown enrichment source "${name}". Configured sources: ${configured.join(", ")}.`
        : `Unknown enrichment source "${name}". Add a "sources:" block to .skeemrc.yaml first.`,
    );
  }

  if (!entry.adapter) {
    throw new UsageError(`Enrichment source "${name}" is missing "adapter" in its config.`);
  }

  // Reference adapters supply a canonical default URL, so a `sources:` entry
  // like `{ adapter: wikidata }` needs no `connection.url`.
  const url = entry.connection?.url ?? defaultAdapterUrl(entry.adapter);
  if (!url) {
    throw new UsageError(`Enrichment source "${name}" is missing "connection.url" in its config.`);
  }

  return {
    adapter: entry.adapter,
    connection: { ...entry.connection, url },
  };
}

/** Dot-path getter. Arrays are terminal-only: a mid-path array yields undefined. */
export function getPath(record: EntityRecord, path: string): unknown {
  let current: unknown = record;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function enrichErrorDetails(spec: ParsedEnrichSpec): Record<string, unknown> {
  return {
    enrich: {
      source: spec.source,
      collection: spec.collection,
      ...(spec.kind === "id" ? { id: spec.id } : { filter: spec.filter }),
    },
  };
}

export function pickEnrichmentMatch(
  spec: ParsedEnrichSpec & { kind: "find" },
  records: EntityRecord[],
): EntityRecord {
  if (records.length === 0) {
    throw new SkemError(
      `--enrich ${spec.raw}: nothing to enrich from (0 matches in "${spec.source}:${spec.collection}").`,
      "NOT_FOUND",
      enrichErrorDetails(spec),
    );
  }

  if (records.length > 1) {
    throw new SkemError(
      `--enrich ${spec.raw}: matched more than one record. Use an id or a narrower filter.`,
      "AMBIGUOUS",
      enrichErrorDetails(spec),
    );
  }

  return records[0]!;
}

export interface EnrichmentApplication {
  node: InputNode;
  enrichedFields: string[];
}

/**
 * The merge rule. Precedence: user fields/children > reserved (upsert match
 * keys) > --map > name-match. Never writes the target primary key; name-match
 * also skips relation fields (an explicit --map may still target them). Pure:
 * the input node is copied, never mutated.
 */
export function applyEnrichment(input: {
  node: InputNode;
  record: EntityRecord;
  collection: Collection;
  maps: ParsedMapEntry[];
  reserved?: ReadonlySet<string>;
}): EnrichmentApplication {
  const { node, record, collection, maps } = input;
  const reserved = input.reserved ?? new Set<string>();
  const fields = { ...node.fields };
  const enriched = new Set<string>();

  const isUserSet = (name: string): boolean =>
    Object.prototype.hasOwnProperty.call(node.fields, name) ||
    Boolean(node.children[name]) ||
    reserved.has(name);

  for (const map of maps) {
    const field = collection.fields.get(map.targetField);
    if (!field) {
      throw new ValidationError(
        collection.name,
        map.targetField,
        `--map target "${map.targetField}" is not a field on "${collection.name}".`,
      );
    }
    if (map.targetField === collection.primaryKey) {
      throw new ValidationError(
        collection.name,
        map.targetField,
        `--map cannot target the primary key "${map.targetField}".`,
      );
    }
    if (isUserSet(map.targetField)) {
      continue;
    }

    const value = coerceEnrichValue(getPath(record, map.sourcePath), field);
    if (value === undefined) {
      continue;
    }
    if (isPlainObject(value) && field.type !== "json") {
      throw new ValidationError(
        collection.name,
        map.targetField,
        `--map source "${map.sourcePath}" is an object but target "${map.targetField}" is ${field.type}, not json.`,
      );
    }

    fields[map.targetField] = value;
    enriched.add(map.targetField);
  }

  for (const [name, rawValue] of Object.entries(record)) {
    const field = collection.fields.get(name);
    if (!field || name === collection.primaryKey) {
      continue;
    }
    if (collection.relations.some((relation) => relation.field === name)) {
      continue;
    }
    if (isUserSet(name) || enriched.has(name)) {
      continue;
    }

    const value = coerceEnrichValue(rawValue, field);
    if (value === undefined) {
      continue;
    }
    if (isPlainObject(value) && field.type !== "json") {
      // Name-match skips silently where an explicit --map errors.
      continue;
    }

    fields[name] = value;
    enriched.add(name);
  }

  return {
    node: {
      fields,
      children: { ...node.children },
      ...(node.selector ? { selector: node.selector } : {}),
    },
    enrichedFields: Array.from(enriched).sort(),
  };
}

function coerceEnrichValue(value: unknown, field: Field): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (field.type === "json" || field.type === "csv") {
      return value;
    }
    if (value.length === 0) {
      return undefined;
    }
    return coerceEnrichValue(value[0], field);
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
