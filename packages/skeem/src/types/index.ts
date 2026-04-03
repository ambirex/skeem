export interface Schema {
  collections: Map<string, Collection>;
}

export interface Collection {
  name: string;
  primaryKey: string;
  fields: Map<string, Field>;
  relations: Relation[];
  uniqueConstraints: UniqueConstraint[];
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
}

export interface SuccessEnvelope {
  ok: true;
  operation: string;
  collection?: string;
  action?: string;
  data?: unknown;
  count?: number;
  plan?: OperationLogEntry[];
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

export interface ExecOperationInput {
  ref: string;
  op: "create" | "get" | "find" | "findOne" | "update" | "delete";
  collection: string;
  id?: string | number;
  data?: Record<string, unknown>;
  filter?: Record<string, unknown>;
}
