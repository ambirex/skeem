import { toErrorEnvelope } from "skeem";
import type { CliGlobalOptions, ErrorEnvelope, Filter, FilterValue, SuccessEnvelope } from "skeem";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** A flat object of scalar field values, as MCP tool callers supply them. */
export type ScalarFields = Record<string, FilterValue>;

/**
 * Turn a `{ field: value }` object into the runtime's `[name, string]` entry
 * list. Values are stringified exactly as the CLI passes them, so the runtime's
 * `parseScalar` applies the same coercions ("true"→bool, "42"→int, "null"→null)
 * and the relation-selector grammar (`@id`, `?f=v`, `??f=v`) keeps working.
 */
export function toFieldEntries(fields: ScalarFields | undefined): Array<[string, string]> {
  return Object.entries(fields ?? {}).map(([key, value]) => [key, value === null ? "null" : String(value)]);
}

/** A `where`/`match` object is already a valid equality `Filter`. */
export function toFilter(where: ScalarFields | undefined): Filter {
  return { ...(where ?? {}) };
}

/** Per-call options every write tool accepts, in MCP snake_case. */
export interface PerCallOptions {
  dry_run?: boolean;
  idempotency_key?: string;
  actor?: string;
  context?: Record<string, unknown>;
}

/**
 * Merge per-call tool options onto the connection-level base options. Connection
 * settings (adapter/url/token/profile) are fixed at server launch; dry-run,
 * idempotency, actor, and context vary per call.
 */
export function mergeCli(base: CliGlobalOptions, opts: PerCallOptions = {}): CliGlobalOptions {
  return {
    ...base,
    dryRun: opts.dry_run ?? false,
    ...(opts.idempotency_key ? { idempotencyKey: opts.idempotency_key } : {}),
    ...(opts.actor ?? base.actor ? { actor: opts.actor ?? base.actor } : {}),
    ...(opts.context ? { context: opts.context } : {}),
  };
}

/**
 * Wrap a skeem envelope as an MCP tool result. The envelope is the canonical
 * JSON text content AND `structuredContent` for typed clients. `ok:false`
 * envelopes are returned as normal results (not `isError`) so agents read the
 * typed `error.code` — the same contract the CLI exposes.
 */
export function envelopeResult(envelope: SuccessEnvelope | ErrorEnvelope): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

/** Convert a thrown runtime error into an `ok:false` envelope result. */
export function errorResult(error: unknown, operation: string, collection?: string): CallToolResult {
  return envelopeResult(toErrorEnvelope(error, operation, collection));
}
