import type { CliGlobalOptions, PrimaryKey, ResolvedConfig } from "../types/index.js";

export interface ProvenanceRecordInput {
  collection: string;
  recordId: PrimaryKey;
  operation: string;
  cli: CliGlobalOptions;
  config: ResolvedConfig;
  actorType?: string;
  createdAt?: string;
  inputRefs?: unknown;
}

export function resolveProvenanceActor(cli: CliGlobalOptions, config: ResolvedConfig): string {
  return cli.actor ?? config.actor ?? "skeem";
}

export function buildProvenanceRecord(input: ProvenanceRecordInput): Record<string, unknown> {
  return {
    collection: input.collection,
    record_id: String(input.recordId),
    operation: input.operation,
    actor: resolveProvenanceActor(input.cli, input.config),
    actor_type: input.actorType ?? "agent",
    ...(input.cli.context ? { context: input.cli.context } : {}),
    ...(input.inputRefs !== undefined ? { input_refs: input.inputRefs } : {}),
    ...(input.cli.idempotencyKey ? { idempotency_key: input.cli.idempotencyKey } : {}),
    created_at: input.createdAt ?? new Date().toISOString(),
  };
}
