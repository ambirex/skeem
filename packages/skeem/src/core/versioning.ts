import type { EntityRecord, PrimaryKey } from "../types/index.js";

export interface VersionRecordInput {
  collection: string;
  recordId: PrimaryKey;
  version: number;
  snapshot: EntityRecord;
  changedFields: string[];
  provenanceId?: string | number;
  createdAt?: string;
}

export function diffChangedFields(previous: EntityRecord, next: EntityRecord): string[] {
  return Array.from(new Set([...Object.keys(previous), ...Object.keys(next)]))
    .filter((field) => stableSerialize(previous[field]) !== stableSerialize(next[field]))
    .sort((left, right) => left.localeCompare(right));
}

export function buildVersionRecord(input: VersionRecordInput): Record<string, unknown> {
  return {
    collection: input.collection,
    record_id: String(input.recordId),
    version: input.version,
    snapshot: input.snapshot,
    ...(input.changedFields.length > 0 ? { changed_fields: input.changedFields } : {}),
    ...(input.provenanceId !== undefined ? { provenance_id: input.provenanceId } : {}),
    created_at: input.createdAt ?? new Date().toISOString(),
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
