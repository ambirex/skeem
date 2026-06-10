// Shared data model and adapter contract live in @skeems/types and are
// re-exported here so the rest of the core package keeps importing from a
// single local module. CLI-only types (config, envelopes, diff/plan, exec)
// are defined below.
export * from "@skeems/types";

import type { AdapterConfig, Filter, PrimaryKey } from "@skeems/types";

export interface CliGlobalOptions {
  adapter?: string;
  url?: string;
  token?: string;
  profile?: string;
  json: boolean;
  noCache: boolean;
  refresh: boolean;
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
  noRollback: boolean;
  allowDestructive: boolean;
  actor?: string;
  context?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ResolvedConfig {
  adapter: string;
  connection: AdapterConfig;
  profile?: string;
  rootDir: string;
  configPath?: string;
  actor?: string;
  schema: {
    aliases: Record<string, string>;
    exclude: string[];
  };
  extensions: Record<string, unknown>;
  cache: {
    ttlMs: number;
  };
}

export interface CacheMeta {
  savedAt: string;
  adapter: string;
  sourceUrl: string;
}

export interface CacheStatus {
  exists: boolean;
  ageMs?: number;
  meta?: CacheMeta;
  cacheDir?: string;
  schemaPath?: string;
  metaPath?: string;
  ttlMs?: number;
}

export type DiffDirection = "define" | "discover";

export type SchemaDiffScope =
  | "collection"
  | "field"
  | "relation"
  | "unique_constraint"
  | "many_to_many_relation";

export type SchemaDiffStatus = "only_in_file" | "only_in_live" | "mismatch";

export type SchemaDiffResolution =
  | "create_in_live"
  | "remove_from_live"
  | "update_live"
  | "create_in_file"
  | "remove_from_file"
  | "update_file";

export interface SchemaDiffChange {
  scope: SchemaDiffScope;
  collection?: string;
  name: string;
  status: SchemaDiffStatus;
  message: string;
  resolution: SchemaDiffResolution;
  fileValue?: unknown;
  liveValue?: unknown;
}

export interface SchemaDiffResult {
  path?: string;
  direction: DiffDirection;
  changes: SchemaDiffChange[];
  matches: string[];
  summary: {
    additions: number;
    removals: number;
    updates: number;
    matches: number;
    totalChanges: number;
  };
}

export type SchemaPlanAction =
  | "create_collection"
  | "create_field"
  | "update_field"
  | "create_relation"
  | "create_unique_constraint"
  | "create_many_to_many_relation"
  | "remove_collection"
  | "remove_field"
  | "remove_relation"
  | "remove_many_to_many_relation"
  | "remove_unique_constraint"
  | "update_relation";

export type SchemaPlanStatus = "planned" | "applied" | "skipped";

export interface SchemaPlanEntry {
  action: SchemaPlanAction;
  status: SchemaPlanStatus;
  collection?: string;
  field?: string;
  destructive: boolean;
  executable: boolean;
  summary: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface SchemaPlanSummary {
  total: number;
  executable: number;
  destructive: number;
  blocked: number;
  applied: number;
  skipped: number;
}

export interface SuccessEnvelope {
  ok: true;
  operation: string;
  collection?: string;
  action?: string;
  data?: unknown;
  count?: number;
  plan?: Array<OperationLogEntry | SchemaPlanEntry>;
}

export interface ErrorEnvelope {
  ok: false;
  operation?: string;
  collection?: string;
  error: {
    code: string;
    message: string;
    field?: string;
    details?: Record<string, unknown>;
  };
}

export interface OperationLogEntry {
  ref: string;
  operation: string;
  collection: string;
  data?: unknown;
  action?: string;
}

export interface InputNode {
  fields: Record<string, unknown>;
  children: Record<string, InputNode>;
  selector?: RelationSelector;
}

export type RelationSelector =
  | {
      kind: "id";
      id: PrimaryKey;
    }
  | {
      kind: "resolve" | "resolveOrCreate";
      filter: Filter;
    };

export interface ExecPlanInput {
  operations: ExecOperationInput[];
}

export interface ExecLinkTargetInput {
  id?: string | number;
  filter?: Record<string, unknown>;
  collection?: string;
}

export interface ExecOperationInput {
  ref: string;
  op: "create" | "get" | "find" | "findOne" | "update" | "delete" | "upsert" | "link" | "unlink";
  collection: string;
  id?: string | number;
  data?: Record<string, unknown>;
  filter?: Record<string, unknown>;
  match?: Record<string, unknown>;
  relation?: string;
  target?: ExecLinkTargetInput;
}
