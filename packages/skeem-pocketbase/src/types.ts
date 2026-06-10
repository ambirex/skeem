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

// PocketBase collection shape returned by /api/collections (v0.23+).
// Fields are flat — there is no nested `options` object.

export interface PocketBaseCollection {
  id: string;
  name: string;
  type: string; // "base" | "auth" | "view"
  system: boolean;
  fields: PocketBaseField[];
  indexes: string[];
}

export interface PocketBaseField {
  id?: string;
  name: string;
  type: string;
  required?: boolean;
  hidden?: boolean;
  system?: boolean;
  // select fields
  values?: string[];
  maxSelect?: number;
  // relation fields
  collectionId?: string;
  collectionName?: string;
  cascadeDelete?: boolean;
  // number fields
  min?: number | null;
  max?: number | null;
  onlyInt?: boolean;
}

export interface PocketBaseListResponse<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export class PocketBaseRequestError extends AdapterError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message, {
      status,
      code,
      kind: pocketbaseErrorKind(status, code),
      collectionMissing: status === 404,
      details,
    });
    this.name = "PocketBaseRequestError";
  }
}

function pocketbaseErrorKind(status: number, code?: string): AdapterErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 404) {
    return "not_found";
  }
  if (code === "validation_unique") {
    return "duplicate";
  }
  if (status === 400) {
    return "validation";
  }
  return "unknown";
}
