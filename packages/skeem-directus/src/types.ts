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

export interface Field {
  name: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  default?: unknown;
  enum?: string[];
}

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

export interface Collection {
  name: string;
  primaryKey: string;
  fields: Map<string, Field>;
  relations: Relation[];
  uniqueConstraints: UniqueConstraint[];
}

export interface Schema {
  collections: Map<string, Collection>;
}

export interface AdapterConfig {
  url: string;
  token?: string;
}

export interface FindOptions {
  limit?: number;
  offset?: number;
  sort?: string;
  expand?: string[];
}

export interface GetOptions {
  expand?: string[];
}

export interface DirectusCollectionRow {
  collection: string;
}

export interface DirectusFieldRow {
  collection: string;
  field: string;
  schema?: {
    data_type?: string | null;
    is_primary_key?: boolean | null;
    is_unique?: boolean | null;
    is_nullable?: boolean | null;
    default_value?: unknown;
    foreign_key_table?: string | null;
    foreign_key_column?: string | null;
  } | null;
}

export class DirectusRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DirectusRequestError";
  }
}
