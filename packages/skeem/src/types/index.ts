export interface Schema {
  collections: Map<string, Collection>;
}

export interface Collection {
  name: string;
  primaryKey: string;
  fields: Map<string, Field>;
  relations: Relation[];
  uniqueConstraints: UniqueConstraint[];
  isJunction?: boolean;
}

export interface Field {
  name: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  default?: unknown;
  enum?: string[];
}

export type FieldType =
  | "string"
  | "text"
  | "integer"
  | "float"
  | "boolean"
  | "datetime"
  | "date"
  | "json"
  | "uuid"
  | "csv";

export interface Relation {
  type: "m2o" | "o2m" | "m2m";
  field: string;
  relatedCollection: string;
  relatedField: string;
  junctionCollection?: string;
  junctionLocalField?: string;
  junctionForeignField?: string;
}

export interface UniqueConstraint {
  fields: string[];
}

export interface Filter {
  [field: string]: FilterValue;
}

export type FilterValue = string | number | boolean | null;
export interface EntityRecord {
  [field: string]: unknown;
}
export type PrimaryKey = string | number;

export interface GetOptions {
  expand?: string[];
}

export interface FindOptions {
  limit?: number;
  offset?: number;
  sort?: string;
  expand?: string[];
}

export interface AdapterConfig {
  url: string;
  token?: string;
  [key: string]: unknown;
}

export interface SkemAdapter {
  readonly name: string;
  connect(config: AdapterConfig): Promise<void>;
  introspect(): Promise<Schema>;
  create(collection: string, data: Record<string, unknown>): Promise<EntityRecord>;
  get(collection: string, id: PrimaryKey, options?: GetOptions): Promise<EntityRecord>;
  find(collection: string, filter: Filter, options?: FindOptions): Promise<EntityRecord[]>;
  findOne(collection: string, filter: Filter): Promise<EntityRecord>;
  update(collection: string, id: PrimaryKey, data: Record<string, unknown>): Promise<EntityRecord>;
  delete(collection: string, id: PrimaryKey): Promise<void>;
  count?(collection: string): Promise<number | null>;
  createMany?(collection: string, data: Record<string, unknown>[]): Promise<EntityRecord[]>;
  createCollection?(input: {
    name: string;
    fields: Array<{
      name: string;
      type: FieldType;
      required?: boolean;
      unique?: boolean;
      default?: unknown;
      enum?: string[];
    }>;
  }): Promise<void>;
  createField?(collection: string, field: {
    name: string;
    type: FieldType;
    required?: boolean;
    unique?: boolean;
    default?: unknown;
    enum?: string[];
  }): Promise<void>;
  updateField?(collection: string, fieldName: string, field: {
    name: string;
    type: FieldType;
    required?: boolean;
    unique?: boolean;
    default?: unknown;
    enum?: string[];
    clearDefault?: boolean;
  }): Promise<void>;
  createRelation?(input: {
    collection: string;
    field: string;
    relatedCollection: string;
    type: Relation["type"];
    inverseField?: string;
    junctionCollection?: string;
    junctionField?: string;
    inverseJunctionField?: string;
  }): Promise<void>;
  updateRelation?(input: {
    collection: string;
    field: string;
    relatedCollection: string;
    type: Relation["type"];
    inverseField?: string;
    junctionCollection?: string;
    junctionField?: string;
    inverseJunctionField?: string;
    currentRelatedCollection?: string;
    currentType?: Relation["type"];
    currentInverseField?: string;
    currentJunctionCollection?: string;
    currentJunctionField?: string;
    currentInverseJunctionField?: string;
  }): Promise<void>;
  deleteField?(collection: string, fieldName: string): Promise<void>;
  deleteRelation?(input: {
    collection: string;
    field: string;
    relatedCollection: string;
    type: Relation["type"];
    inverseField?: string;
    junctionCollection?: string;
    junctionField?: string;
    inverseJunctionField?: string;
  }): Promise<void>;
  deleteCollection?(collection: string): Promise<void>;
}

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
