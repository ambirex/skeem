import { parseDurationMs, timestampFromDuration } from "./duration.js";
import { UsageError } from "../errors/index.js";
import type { CliGlobalOptions, EntityRecord, ResolvedConfig } from "../types/index.js";

export function parseLeaseDuration(value: string): number {
  return parseDurationMs(value, "--lease");
}

export function leaseUntilFromDuration(durationMs: number, now = new Date()): string {
  return timestampFromDuration(durationMs, now);
}

export function isClaimActive(row: EntityRecord, now = new Date()): boolean {
  const leaseUntil = parseTimestamp(row.lease_until);
  return leaseUntil !== null && leaseUntil > now.getTime();
}

export function resolveClaimActor(cli: CliGlobalOptions, config: ResolvedConfig): string {
  const actor = cli.actor ?? config.actor;
  if (!actor) {
    throw new UsageError("Claim operations require --actor or a configured actor.");
  }
  return actor;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
