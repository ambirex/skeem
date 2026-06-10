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

// MediaWiki / Wikibase Action API response shapes (read-only subset).

export interface WikibaseTermValue {
  language: string;
  value: string;
}

export interface WikibaseSnak {
  snaktype: "value" | "novalue" | "somevalue";
  property: string;
  datavalue?: { value: unknown; type: string };
}

export interface WikibaseStatement {
  mainsnak?: WikibaseSnak;
}

export interface WikibaseEntity {
  type?: string;
  id: string;
  /** Present (empty string) when the requested entity does not exist. */
  missing?: string;
  datatype?: string;
  labels?: Record<string, WikibaseTermValue>;
  descriptions?: Record<string, WikibaseTermValue>;
  aliases?: Record<string, WikibaseTermValue[]>;
  claims?: Record<string, WikibaseStatement[]>;
}

export interface WbGetEntitiesResponse {
  entities?: Record<string, WikibaseEntity>;
  error?: { code?: string; info?: string };
}

export interface WbSearchEntitiesResponse {
  search?: Array<{ id: string; label?: string; description?: string }>;
  error?: { code?: string; info?: string };
}

export class WikiDataRequestError extends AdapterError {
  constructor(message: string, status: number, code?: string) {
    super(message, {
      status,
      code,
      kind: wikidataErrorKind(status),
      collectionMissing: false,
    });
    this.name = "WikiDataRequestError";
  }
}

function wikidataErrorKind(status: number): AdapterErrorKind {
  if (status === 404) return "not_found";
  if (status === 429) return "unknown"; // rate limited
  if (status === 400) return "validation";
  return "unknown";
}
