import { resolveProvenanceActor } from "./provenance.js";
import type { CliGlobalOptions, EntityRecord, PrimaryKey, ResolvedConfig } from "../types/index.js";

export interface TrashRecordInput {
  collection: string;
  recordId: PrimaryKey;
  snapshot: EntityRecord;
  cli: CliGlobalOptions;
  config: ResolvedConfig;
  provenanceId?: string | number;
  deletedAt?: string;
  expiresAt?: string;
}

export function buildTrashRecord(input: TrashRecordInput): Record<string, unknown> {
  const actor = resolveProvenanceActor(input.cli, input.config);

  return {
    collection: input.collection,
    record_id: String(input.recordId),
    snapshot: input.snapshot,
    ...(actor ? { deleted_by: actor } : {}),
    ...(input.provenanceId !== undefined ? { provenance_id: input.provenanceId } : {}),
    deleted_at: input.deletedAt ?? new Date().toISOString(),
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
  };
}
