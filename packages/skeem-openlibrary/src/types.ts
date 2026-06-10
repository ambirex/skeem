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
} from "@skeems/types";

// Open Library JSON shapes (read-only subset).

export interface OlRecord {
  key?: string;
  type?: { key?: string };
  location?: string; // present on /type/redirect records (merged entities)
  title?: string;
  name?: string;
  description?: string | { type?: string; value?: string };
  bio?: string | { type?: string; value?: string };
  subjects?: string[];
  first_publish_date?: string;
  publish_date?: string;
  publishers?: string[];
  number_of_pages?: number;
  birth_date?: string;
  death_date?: string;
  authors?: Array<{ author?: { key?: string }; key?: string } | { type?: unknown }>;
  works?: Array<{ key?: string }>;
  isbn_10?: string[];
  isbn_13?: string[];
  oclc_numbers?: string[];
  lccn?: string[];
  identifiers?: Record<string, string[]>;
  remote_ids?: Record<string, string>;
  error?: string;
}

export interface OlWorkSearchResponse {
  numFound?: number;
  docs?: Array<{
    key?: string;
    title?: string;
    first_publish_year?: number;
    author_name?: string[];
    author_key?: string[];
  }>;
}

export interface OlAuthorSearchResponse {
  numFound?: number;
  docs?: Array<{
    key?: string;
    name?: string;
    birth_date?: string;
    top_work?: string;
  }>;
}

export class OpenLibraryRequestError extends AdapterError {
  constructor(message: string, status: number) {
    super(message, {
      status,
      kind: openLibraryErrorKind(status),
      collectionMissing: false,
    });
    this.name = "OpenLibraryRequestError";
  }
}

function openLibraryErrorKind(status: number): AdapterErrorKind {
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "validation";
  if (status === 401 || status === 403) return "auth";
  return "unknown";
}
