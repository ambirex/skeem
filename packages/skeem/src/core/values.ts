import { UsageError, ValidationError } from "../errors/index.js";
import type { Collection, ExecOperationInput, Field, FieldType, Filter, InputNode, RelationSelector } from "../types/index.js";

const REF_PATTERN = /^\$([a-zA-Z0-9_-]+)((?:\.[a-zA-Z0-9_-]+)+)$/;
const INT_PATTERN = /^-?\d+$/;
const FLOAT_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * Coerce a raw CLI value to a typed scalar. Precedence:
 *   1. an explicit type prefix (`str:`/`int:`/`float:`/`bool:`/`json:`) wins;
 *   2. otherwise the declared field type (from the introspected schema) drives
 *      coercion — so a numeric-looking string in a `string` field stays a
 *      string (an ISBN is a name, not arithmetic);
 *   3. with no type (field absent from schema), fall back to the heuristic.
 * `null` is the universal "unset" sentinel under (2)/(3); use `str:null` for the
 * literal string. `str:` also escapes the relation prefixes (`str:@x` → "@x").
 */
export function parseScalar(raw: string, fieldType?: FieldType): unknown {
  const typed = parseTypedPrefix(raw);
  if (typed) {
    return typed.value;
  }
  if (fieldType) {
    return coerceByType(raw, fieldType);
  }
  return parseHeuristic(raw);
}

const TYPE_TAGS = new Set(["str", "int", "float", "bool", "json"]);

/** Honor an explicit `tag:value` type prefix; returns undefined if none/unknown. */
function parseTypedPrefix(raw: string): { value: unknown } | undefined {
  const colon = raw.indexOf(":");
  if (colon === -1) {
    return undefined;
  }
  const tag = raw.slice(0, colon);
  if (!TYPE_TAGS.has(tag)) {
    return undefined; // e.g. "http://…" or "note: …" pass through untouched
  }
  const rest = raw.slice(colon + 1);
  switch (tag) {
    case "str":
      return { value: rest };
    case "int":
      if (!INT_PATTERN.test(rest)) throw new UsageError(`int: expects an integer, got "${rest}".`);
      return { value: Number.parseInt(rest, 10) };
    case "float":
      if (!FLOAT_PATTERN.test(rest)) throw new UsageError(`float: expects a number, got "${rest}".`);
      return { value: Number.parseFloat(rest) };
    case "bool":
      if (rest !== "true" && rest !== "false") throw new UsageError(`bool: expects true or false, got "${rest}".`);
      return { value: rest === "true" };
    case "json":
      try {
        return { value: JSON.parse(rest) };
      } catch {
        throw new UsageError(`json: expects valid JSON, got "${rest}".`);
      }
    default:
      return undefined;
  }
}

/** Schema-directed coercion by the field's declared type. */
function coerceByType(raw: string, fieldType: FieldType): unknown {
  if (raw === "null") {
    return null; // universal unset; use str:null for the literal string
  }
  switch (fieldType) {
    case "integer":
      return INT_PATTERN.test(raw) ? Number.parseInt(raw, 10) : raw;
    case "float":
      return FLOAT_PATTERN.test(raw) ? Number.parseFloat(raw) : raw;
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      return raw;
    // string/text/uuid/csv/date/datetime/json are stored as given; a json field
    // gets real parsing only via the explicit `json:` prefix, to avoid changing
    // existing string-passing flows.
    default:
      return raw;
  }
}

/** Type-blind heuristic — only when the field is absent from the schema. */
function parseHeuristic(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (INT_PATTERN.test(raw)) return Number.parseInt(raw, 10);
  if (FLOAT_PATTERN.test(raw)) return Number.parseFloat(raw);
  return raw;
}

/**
 * Schema-direct an equality filter (`--where`/`--match`) the same way the write
 * path coerces field values, so a value written and a value matched agree (a
 * string ISBN matches the stored string, not a coerced number). Only string
 * values are re-coerced — callers that already supply typed values (MCP, exec)
 * are left as-is. Explicit type prefixes are honored.
 */
export function coerceFilter(filter: Filter, collection: Collection): Filter {
  const out: Filter = {};
  for (const [field, value] of Object.entries(filter)) {
    out[field] =
      typeof value === "string"
        ? (parseScalar(value, collection.fields.get(field)?.type) as string | number | boolean | null)
        : value;
  }
  return out;
}

export function parseFilterAssignment(raw: string): { field: string; value: string | number | boolean | null } {
  const separator = raw.indexOf("=");
  if (separator === -1) {
    throw new UsageError(`Expected field=value but received "${raw}".`);
  }

  const field = raw.slice(0, separator);
  const value = raw.slice(separator + 1);
  return { field, value: parseScalar(value) as string | number | boolean | null };
}

export function buildInputNode(entries: Array<[string, string]>, collection: Collection): InputNode {
  const root: InputNode = { fields: {}, children: {} };

  for (const [path, rawValue] of entries) {
    const segments = path.split(".");
    // Top-level leaves coerce against the target collection's declared field
    // types; nested children belong to a related collection whose schema we
    // don't have here, so they fall back to the heuristic (explicit type
    // prefixes still work at any depth).
    insertIntoNode(root, segments, rawValue, collection.name, collection.fields);
  }

  return root;
}

function insertIntoNode(
  node: InputNode,
  segments: string[],
  rawValue: string,
  collectionName: string,
  fields?: Map<string, Field>,
): void {
  const [head, ...tail] = segments;
  if (!head) {
    throw new UsageError("Encountered an empty field path.");
  }

  if (tail.length === 0) {
    const selector = parseRelationSelector(rawValue);
    if (selector) {
      const child = node.children[head] ?? { fields: {}, children: {} };
      child.selector = selector;
      node.children[head] = child;
      return;
    }

    if (node.children[head]) {
      throw new ValidationError(collectionName, head, `Cannot set both relation selector and scalar field for "${head}".`);
    }

    node.fields[head] = parseScalar(rawValue, fields?.get(head)?.type);
    return;
  }

  const child = node.children[head] ?? { fields: {}, children: {} };
  node.children[head] = child;
  insertIntoNode(child, tail, rawValue, collectionName, undefined);
}

function parseRelationSelector(rawValue: string): RelationSelector | undefined {
  if (rawValue.startsWith("@")) {
    return {
      kind: "id",
      id: parseScalar(rawValue.slice(1)) as string | number,
    };
  }

  if (rawValue.startsWith("??")) {
    const assignment = parseFilterAssignment(rawValue.slice(2));
    return {
      kind: "resolveOrCreate",
      filter: { [assignment.field]: assignment.value } satisfies Filter,
    };
  }

  if (rawValue.startsWith("?")) {
    const assignment = parseFilterAssignment(rawValue.slice(1));
    return {
      kind: "resolve",
      filter: { [assignment.field]: assignment.value } satisfies Filter,
    };
  }

  return undefined;
}

export function extractRefDependencies(value: unknown): string[] {
  const refs = new Set<string>();
  walk(value, (candidate) => {
    if (typeof candidate !== "string") {
      return;
    }
    const match = candidate.match(REF_PATTERN);
    if (match) {
      refs.add(match[1]!);
    }
  });
  return Array.from(refs);
}

export function resolveRefs<T>(value: T, context: Record<string, Record<string, unknown>>): T {
  if (typeof value === "string") {
    const match = value.match(REF_PATTERN);
    if (!match) {
      return value;
    }

    const record = context[match[1]!];
    if (!record) {
      throw new UsageError(`Unknown ref "${match[1]}" referenced in "${value}".`);
    }

    let current: unknown = record;
    for (const segment of match[2]!.slice(1).split(".")) {
      if (!current || typeof current !== "object" || !(segment in current)) {
        throw new UsageError(`Cannot resolve ref "${value}"; segment "${segment}" was not found.`);
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveRefs(entry, context)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, resolveRefs(nestedValue, context)]),
    ) as T;
  }

  return value;
}

export function topoSortOperations(operations: ExecOperationInput[]): ExecOperationInput[] {
  const byRef = new Map<string, ExecOperationInput>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: ExecOperationInput[] = [];
  const path: string[] = [];

  for (const operation of operations) {
    if (!operation.ref || operation.ref.trim().length === 0) {
      throw new UsageError("Exec operations require a non-empty ref.");
    }
    if (byRef.has(operation.ref)) {
      throw new UsageError(`Duplicate exec ref "${operation.ref}".`);
    }
    byRef.set(operation.ref, operation);
  }

  for (const operation of operations) {
    visit(operation.ref);
  }

  return ordered;

  function visit(ref: string, fromRef?: string): void {
    if (visited.has(ref)) {
      return;
    }

    const operation = byRef.get(ref);
    if (!operation) {
      throw new UsageError(
        fromRef
          ? `Exec operation "${fromRef}" references unknown ref "${ref}".`
          : `Missing operation ref "${ref}".`,
      );
    }
    if (visiting.has(ref)) {
      const cycleStart = path.indexOf(ref);
      const cyclePath = [...path.slice(cycleStart === -1 ? 0 : cycleStart), ref].join(" -> ");
      throw new UsageError(`Cycle detected in exec plan: ${cyclePath}.`);
    }

    visiting.add(ref);
    path.push(ref);
    for (const dependency of extractRefDependencies(operation)) {
      visit(dependency, ref);
    }
    path.pop();
    visiting.delete(ref);
    visited.add(ref);
    ordered.push(operation);
  }
}

function walk(value: unknown, visitor: (value: unknown) => void): void {
  visitor(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      walk(entry, visitor);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      walk(nestedValue, visitor);
    }
  }
}
