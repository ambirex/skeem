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

// NocoDB meta-API shapes (v2). NocoDB addresses tables and columns by id, not
// name, so the adapter keeps a catalog that resolves skeem's name-based
// contract onto these ids.

export interface NocoColumn {
  id: string;
  title: string;
  column_name?: string;
  uidt: string;
  pk?: boolean;
  pv?: boolean;
  rqd?: boolean;
  unique?: boolean;
  system?: boolean;
  colOptions?: NocoColumnOptions | null;
}

export interface NocoColumnOptions {
  // LinkToAnotherRecord / Links
  type?: "bt" | "hm" | "mm" | "oo";
  fk_related_model_id?: string;
  // Single/Multi select
  options?: Array<{ title: string; color?: string }>;
}

export interface NocoTable {
  id: string;
  title: string;
  table_name?: string;
  columns?: NocoColumn[];
}

export interface NocoListResponse<T> {
  list: T[];
  pageInfo?: {
    totalRows?: number;
    page?: number;
    pageSize?: number;
    isFirstPage?: boolean;
    isLastPage?: boolean;
  };
}

export interface NocoBase {
  id: string;
  title?: string;
}

export class NocoDbRequestError extends AdapterError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message, {
      status,
      code,
      kind: nocodbErrorKind(status, message),
      collectionMissing: status === 404,
      details,
    });
    this.name = "NocoDbRequestError";
  }
}

function nocodbErrorKind(status: number, message: string): AdapterErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 404) {
    return "not_found";
  }
  if (/unique|duplicate/i.test(message)) {
    return "duplicate";
  }
  if (status === 400 || status === 422) {
    return "validation";
  }
  return "unknown";
}
