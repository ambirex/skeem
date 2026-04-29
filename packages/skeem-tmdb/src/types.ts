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

export interface TmdbSourceConfig {
  api_key?: string;
  apiKey?: string;
  read_token?: string;
  readToken?: string;
  base_url?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  [key: string]: unknown;
}

export interface TmdbSourceFieldDefinition {
  name: string;
  type: FieldType;
  description?: string;
}

export interface TmdbSourceCollectionDefinition {
  name: string;
  description?: string;
  primaryKey: string;
  searchable: boolean;
  fields: TmdbSourceFieldDefinition[];
}

export interface TmdbSourceSchema {
  source: string;
  description?: string;
  collections: TmdbSourceCollectionDefinition[];
}

export class TmdbRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TmdbRequestError";
  }
}
