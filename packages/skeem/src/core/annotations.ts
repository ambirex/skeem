import { parseDurationMs, timestampFromDuration } from "./duration.js";
import { UsageError } from "../errors/index.js";
import type { CliGlobalOptions, PrimaryKey, ResolvedConfig } from "../types/index.js";

export interface AnnotationRecordInput {
  collection: string;
  recordId: PrimaryKey;
  key: string;
  value: unknown;
  cli: CliGlobalOptions;
  config: ResolvedConfig;
  createdAt?: string;
  expiresAt?: string;
}

export function normalizeAnnotationKey(value: string): string {
  const key = value.trim();
  if (key.length === 0) {
    throw new UsageError("Annotation key must not be empty.");
  }
  return key;
}

export function parseAnnotationValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new UsageError("Expected --value to be valid JSON.");
  }
}

export function resolveAnnotationActor(cli: CliGlobalOptions, config: ResolvedConfig): string | undefined {
  return cli.actor ?? config.actor;
}

export function resolveAnnotationExpiry(expiresInput?: string, now = new Date()): string | undefined {
  if (!expiresInput) {
    return undefined;
  }
  return timestampFromDuration(parseDurationMs(expiresInput, "--expires"), now);
}

export function buildAnnotationRecord(input: AnnotationRecordInput): Record<string, unknown> {
  const actor = resolveAnnotationActor(input.cli, input.config);

  return {
    collection: input.collection,
    record_id: String(input.recordId),
    key: input.key,
    value: input.value,
    ...(actor ? { actor } : {}),
    created_at: input.createdAt ?? new Date().toISOString(),
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
  };
}
