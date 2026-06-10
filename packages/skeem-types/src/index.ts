/**
 * Shared types for the skeem CLI and its backend adapters.
 *
 * This package is the single source of truth for the backend-agnostic data
 * model (schema, fields, relations) and the {@link SkemAdapter} contract that
 * every adapter implements. It has zero runtime dependencies so both the core
 * CLI and adapter packages can depend on it without creating an import cycle.
 */

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
  /**
   * Relation fields to expand. Expansion is one level deep — the adapter
   * fetches `["*", "<relation>.*"]`, so nested paths like `a.b.c` only
   * resolve the first hop.
   */
  expand?: string[];
}

export interface FindOptions {
  limit?: number;
  offset?: number;
  sort?: string;
  /** See {@link GetOptions.expand} — one level deep. */
  expand?: string[];
}

export interface AdapterConfig {
  url: string;
  token?: string;
  [key: string]: unknown;
}

export interface SchemaFieldInput {
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  enum?: string[];
  /** Update-only: explicitly clear an existing default value. */
  clearDefault?: boolean;
}

export interface SchemaCollectionInput {
  name: string;
  fields: SchemaFieldInput[];
}

export interface SchemaRelationInput {
  collection: string;
  field: string;
  relatedCollection: string;
  type: Relation["type"];
  inverseField?: string;
  junctionCollection?: string;
  junctionField?: string;
  inverseJunctionField?: string;
}

/**
 * The contract every backend adapter implements. Core data verbs are required;
 * schema-mutation methods are optional so an adapter can declare partial
 * capability (a backend with a fixed schema can omit them).
 *
 * Implementations should map backend errors to the shared skeem error classes
 * where possible. `findOne` is intentionally absent — it is derived behavior
 * (`find` + a single-match check) and lives in the runtime.
 */
export interface SkemAdapter {
  readonly name: string;
  connect(config: AdapterConfig): Promise<void>;
  introspect(): Promise<Schema>;
  create(collection: string, data: Record<string, unknown>): Promise<EntityRecord>;
  get(collection: string, id: PrimaryKey, options?: GetOptions): Promise<EntityRecord>;
  /** Filters match by equality only; values are compared with `=`. */
  find(collection: string, filter: Filter, options?: FindOptions): Promise<EntityRecord[]>;
  update(collection: string, id: PrimaryKey, data: Record<string, unknown>): Promise<EntityRecord>;
  delete(collection: string, id: PrimaryKey): Promise<void>;
  count?(collection: string): Promise<number | null>;
  createMany?(collection: string, data: Record<string, unknown>[]): Promise<EntityRecord[]>;
  createCollection?(input: SchemaCollectionInput): Promise<void>;
  createField?(collection: string, field: SchemaFieldInput): Promise<void>;
  updateField?(collection: string, fieldName: string, field: SchemaFieldInput): Promise<void>;
  createRelation?(input: SchemaRelationInput): Promise<void>;
  /**
   * Change a relation by replacing `from` with `to`. Backends without a
   * relation-update primitive (e.g. Directus) implement this as a
   * delete-then-recreate, which is not atomic.
   */
  updateRelation?(from: SchemaRelationInput, to: SchemaRelationInput): Promise<void>;
  deleteField?(collection: string, fieldName: string): Promise<void>;
  deleteRelation?(input: SchemaRelationInput): Promise<void>;
  deleteCollection?(collection: string): Promise<void>;
  /**
   * Link two records over an m2m relation. Backends whose m2m has no writable
   * junction collection (PocketBase relation arrays, NocoDB native `mm`)
   * implement this so the core can link without a junction; backends with a real
   * junction (Directus) omit it and the core writes the junction row directly.
   * Implementations must be idempotent and report whether a change occurred.
   */
  link?(collection: string, id: PrimaryKey, relation: Relation, targetId: PrimaryKey): Promise<LinkResult>;
  unlink?(collection: string, id: PrimaryKey, relation: Relation, targetId: PrimaryKey): Promise<LinkResult>;
}

export interface LinkResult {
  /** True if this call changed the link (false if it was already in the desired state). */
  changed: boolean;
}

/**
 * Semantic classification of a backend request failure. Adapters translate
 * their backend-specific HTTP errors into this vocabulary so the core can map
 * them to user-facing error classes without knowing any backend's quirks.
 */
export type AdapterErrorKind = "not_found" | "validation" | "duplicate" | "auth" | "unknown";

export interface AdapterErrorInit {
  kind?: AdapterErrorKind;
  status?: number;
  code?: string;
  /** True when the failure means the target collection/table does not exist. */
  collectionMissing?: boolean;
  field?: string;
  details?: Record<string, unknown>;
}

/**
 * The error every adapter throws for a failed backend request. Because it lives
 * in this shared package, the core can `instanceof`-check it across package
 * boundaries and branch on `kind`/`collectionMissing` rather than duck-typing a
 * specific backend's error shape.
 */
export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly collectionMissing: boolean;
  readonly field?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, init: AdapterErrorInit = {}) {
    super(message);
    this.name = "AdapterError";
    this.kind = init.kind ?? "unknown";
    this.status = init.status;
    this.code = init.code;
    this.collectionMissing = init.collectionMissing ?? false;
    this.field = init.field;
    this.details = init.details;
  }
}
