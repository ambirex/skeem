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

export interface OpenLibrarySourceConfig {
  base_url?: string;
  baseUrl?: string;
  user_agent?: string;
  userAgent?: string;
  fetch?: typeof fetch;
  [key: string]: unknown;
}

export interface OpenLibrarySourceFieldDefinition {
  name: string;
  type: FieldType;
  description?: string;
}

export interface OpenLibrarySourceCollectionDefinition {
  name: string;
  description?: string;
  primaryKey: string;
  searchable: boolean;
  fields: OpenLibrarySourceFieldDefinition[];
}

export interface OpenLibrarySourceSchema {
  source: string;
  description?: string;
  collections: OpenLibrarySourceCollectionDefinition[];
}

export class OpenLibraryRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OpenLibraryRequestError";
  }
}
