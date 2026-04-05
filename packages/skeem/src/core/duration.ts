import { UsageError } from "../errors/index.js";

const DURATION_UNITS_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

export function parseDurationMs(value: string, flagName = "duration"): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) {
    throw new UsageError(`Expected ${flagName} to use a duration like "30s", "5m", "2h", or "1d".`);
  }

  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const multiplier = DURATION_UNITS_MS[unit];
  if (multiplier === undefined) {
    throw new UsageError(`Expected ${flagName} to use a duration like "30s", "5m", "2h", or "1d".`);
  }

  const durationMs = amount * multiplier;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new UsageError(`${flagName} must be greater than zero.`);
  }

  return durationMs;
}

export function timestampFromDuration(durationMs: number, now = new Date()): string {
  return new Date(now.getTime() + durationMs).toISOString();
}
