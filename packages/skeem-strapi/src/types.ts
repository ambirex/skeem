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

// Strapi v5 content-type-builder shapes (admin API, read-only here).

export interface StrapiAttribute {
  type: string;
  required?: boolean;
  unique?: boolean;
  enum?: string[];
  // relation attributes
  relation?: "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";
  target?: string; // a uid, e.g. "api::company.company"
}

export interface StrapiContentType {
  uid: string;
  apiID?: string;
  schema: {
    kind: "collectionType" | "singleType";
    displayName?: string;
    singularName: string;
    pluralName: string;
    draftAndPublish?: boolean;
    attributes: Record<string, StrapiAttribute>;
  };
}

export interface StrapiListResponse<T> {
  data: T[];
  meta?: {
    pagination?: {
      page?: number;
      pageSize?: number;
      pageCount?: number;
      total?: number;
    };
  };
}

export interface StrapiSingleResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export class StrapiRequestError extends AdapterError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message, {
      status,
      code,
      kind: strapiErrorKind(status, message),
      collectionMissing: status === 404,
      details,
    });
    this.name = "StrapiRequestError";
  }
}

function strapiErrorKind(status: number, message: string): AdapterErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 404) {
    return "not_found";
  }
  if (/unique/i.test(message)) {
    return "duplicate";
  }
  if (status === 400 || status === 422) {
    return "validation";
  }
  return "unknown";
}
