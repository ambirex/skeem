// Shared data model and input shapes come from @skeems/types. They are
// re-exported so the rest of this package keeps importing from "./types.js".
import { AdapterError, type AdapterErrorKind } from "@skeems/types";

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
    options?: {
      choices?: Array<{ text?: string; value?: string }> | null;
    } | null;
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

export class DirectusRequestError extends AdapterError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message, {
      status,
      code,
      kind: directusErrorKind(status, code),
      // A missing collection surfaces as 404, or 403 phrased as "does not exist".
      collectionMissing: status === 404 || (status === 403 && /does not exist/i.test(message)),
      details,
    });
    this.name = "DirectusRequestError";
  }
}

function directusErrorKind(status: number, code?: string): AdapterErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (code === "FAILED_VALIDATION") {
    return "validation";
  }
  if (code === "RECORD_NOT_UNIQUE") {
    return "duplicate";
  }
  if (status === 404) {
    return "not_found";
  }
  return "unknown";
}
