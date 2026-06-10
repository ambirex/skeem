// Shared data model and input shapes come from @skeems/types. They are
// re-exported so the rest of this package keeps importing from "./types.js".
export type {
  AdapterConfig,
  Collection,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  Relation,
  Schema,
  SchemaCollectionInput,
  SchemaFieldInput,
  SchemaRelationInput,
  UniqueConstraint,
} from "@skeems/types";

// Directus-specific row shapes returned by the Directus API.

export interface DirectusCollectionRow {
  collection: string;
}

export interface DirectusFieldRow {
  collection: string;
  field: string;
  type?: string | null;
  meta?: {
    special?: string[] | null;
  } | null;
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

export interface DirectusRelationRow {
  collection: string;
  field: string;
  related_collection: string;
  meta?: {
    id?: number;
    many_collection?: string | null;
    many_field?: string | null;
    one_collection?: string | null;
    one_field?: string | null;
    junction_field?: string | null;
  } | null;
  schema?: {
    table?: string | null;
    column?: string | null;
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
