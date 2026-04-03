import { UsageError, ValidationError } from "../errors/index.js";
import type { ExecOperationInput, Filter, InputNode, RelationSelector } from "../types/index.js";

const REF_PATTERN = /^\$([a-zA-Z0-9_-]+)((?:\.[a-zA-Z0-9_-]+)+)$/;

export function parseScalar(raw: string): unknown {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw === "null") {
    return null;
  }
  if (/^-?\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  if (/^-?\d+\.\d+$/.test(raw)) {
    return Number.parseFloat(raw);
  }
  return raw;
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

export function buildInputNode(entries: Array<[string, string]>, collection: string): InputNode {
  const root: InputNode = { fields: {}, children: {} };

  for (const [path, rawValue] of entries) {
    const segments = path.split(".");
    insertIntoNode(root, segments, rawValue, collection);
  }

  return root;
}

function insertIntoNode(node: InputNode, segments: string[], rawValue: string, collection: string): void {
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
      throw new ValidationError(collection, head, `Cannot set both relation selector and scalar field for "${head}".`);
    }

    node.fields[head] = parseScalar(rawValue);
    return;
  }

  const child = node.children[head] ?? { fields: {}, children: {} };
  node.children[head] = child;
  insertIntoNode(child, tail, rawValue, collection);
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
