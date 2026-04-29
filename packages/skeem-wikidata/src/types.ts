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

export interface WikidataSourceConfig {
  base_url?: string;
  baseUrl?: string;
  language?: string;
  user_agent?: string;
  userAgent?: string;
  fetch?: typeof fetch;
  [key: string]: unknown;
}

export interface WikidataSourceFieldDefinition {
  name: string;
  type: FieldType;
  description?: string;
}

export interface WikidataSourceCollectionDefinition {
  name: string;
  description?: string;
  primaryKey: string;
  searchable: boolean;
  fields: WikidataSourceFieldDefinition[];
}

export interface WikidataSourceSchema {
  source: string;
  description?: string;
  collections: WikidataSourceCollectionDefinition[];
  external_id_properties: Array<{
    key: string;
    property: string;
    description: string;
  }>;
}

export class WikidataRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WikidataRequestError";
  }
}
