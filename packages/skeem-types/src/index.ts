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
  updateRelation?(
    input: SchemaRelationInput & {
      currentRelatedCollection?: string;
      currentType?: Relation["type"];
      currentInverseField?: string;
      currentJunctionCollection?: string;
      currentJunctionField?: string;
      currentInverseJunctionField?: string;
    },
  ): Promise<void>;
  deleteField?(collection: string, fieldName: string): Promise<void>;
  deleteRelation?(input: SchemaRelationInput): Promise<void>;
  deleteCollection?(collection: string): Promise<void>;
}
