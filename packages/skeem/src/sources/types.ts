import type { EntityRecord, Filter, FieldType, PrimaryKey } from "../types/index.js";

export interface ReadSourceConfig {
  [key: string]: unknown;
}

export interface ReadSourceFieldDefinition {
  name: string;
  type: FieldType;
  description?: string;
}

export interface ReadSourceCollectionDefinition {
  name: string;
  description?: string;
  primaryKey: string;
  searchable: boolean;
  fields: ReadSourceFieldDefinition[];
}

export interface ReadSourceSchema {
  source: string;
  description?: string;
  collections: ReadSourceCollectionDefinition[];
}

export interface ReadSourceFindOptions {
  limit?: number;
  offset?: number;
  sort?: string;
}

export interface ReadSource {
  readonly name: string;
  readonly kind: "read_source";
  connect(config: ReadSourceConfig): Promise<void>;
  describe(): ReadSourceSchema;
  get(collection: string, id: PrimaryKey): Promise<EntityRecord>;
  find(
    collection: string,
    filter: Filter,
    options?: ReadSourceFindOptions,
  ): Promise<EntityRecord[]>;
}

export type ReadSourceFactory = () => ReadSource;
