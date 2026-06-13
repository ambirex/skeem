import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SkeemRuntime } from "skeem";
import type { CliGlobalOptions } from "skeem";

import { registerSkeemTools } from "./tools.js";

export interface CreateServerOptions {
  /** Connection-level options applied to every tool call. */
  baseCli: CliGlobalOptions;
  /** Directory the runtime resolves `.skeemrc.yaml` from. */
  cwd: string;
  /** Register only read tools when true. */
  readOnly?: boolean;
  /** Reported as the MCP server version. */
  version?: string;
  /** Test seam: supply a runtime directly instead of constructing one lazily. */
  getRuntime?: () => Promise<SkeemRuntime>;
}

const INSTRUCTIONS = `skeem exposes relational CRUD over a headless backend (Directus/PocketBase/NocoDB/Strapi) or a read-only reference dataset (WikiData, MusicBrainz, OSM, OpenLibrary, CrossRef, TMDB).

Every tool returns a JSON envelope. On success: { "ok": true, "operation", "collection", "data", ... }. On failure: { "ok": false, "error": { "code", "message", "field"? } } — a NORMAL result, not a protocol error, so branch on error.code: NOT_FOUND, AMBIGUOUS, DUPLICATE, VALIDATION, AUTH, RELATION_NOT_FOUND, SCHEMA_UNSUPPORTED, CACHE_STALE, USAGE, ERROR.

Work discover-first: call skeem_ls then skeem_describe before writing, so you use real collection and relation names. Relation fields in create/update/upsert accept the related id, "?field=value" to resolve an existing record, or "??field=value" to resolve-or-create. Deletes are soft (recoverable via skeem_restore) unless hard=true. For multi-agent work, skeem_claim a record before mutating it and skeem_release when done; leave breadcrumbs with skeem_annotate. Coordination, trash, and idempotency require the system collections — run skeem_init once if they are missing.

Schema-mutating commands (define/diff) and alias management are intentionally not exposed here; use the skeem CLI for those.`;

/**
 * Wrap a runtime factory so it runs at most once and caches the result — but
 * resets the cache if the factory rejects, so a later call retries after the
 * user fixes their config or brings the backend up. This is what makes config
 * errors surface as a readable `ok:false` envelope on the first tool call
 * instead of crashing the server at launch.
 */
export function createLazyRuntimeGetter(factory: () => Promise<SkeemRuntime>): () => Promise<SkeemRuntime> {
  let pending: Promise<SkeemRuntime> | undefined;
  return () => {
    if (!pending) {
      pending = factory().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

/** Build the skeem MCP server with all tools registered (see registerSkeemTools). */
export function createSkeemMcpServer(options: CreateServerOptions): McpServer {
  const server = new McpServer(
    { name: "skeem", version: options.version ?? "0.0.0-dev" },
    { instructions: INSTRUCTIONS },
  );

  const getRuntime =
    options.getRuntime ?? createLazyRuntimeGetter(() => SkeemRuntime.create(options.cwd, options.baseCli));

  registerSkeemTools(server, { getRuntime, baseCli: options.baseCli, readOnly: options.readOnly ?? false });

  return server;
}
