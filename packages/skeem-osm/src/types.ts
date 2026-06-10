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

export type OsmElementType = "node" | "way" | "relation";

export interface OsmElement {
  type: OsmElementType;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  members?: Array<{ type: string; ref: number; role: string }>;
}

export interface OsmElementsResponse {
  elements?: OsmElement[];
}

export interface NominatimResult {
  osm_type: OsmElementType | string;
  osm_id: number;
  display_name?: string;
  name?: string;
  category?: string;
  class?: string;
  lat?: string;
  lon?: string;
  extratags?: Record<string, string> | null;
}

export class OsmRequestError extends AdapterError {
  constructor(message: string, status: number) {
    super(message, {
      status,
      kind: osmErrorKind(status),
      collectionMissing: false,
    });
    this.name = "OsmRequestError";
  }
}

function osmErrorKind(status: number): AdapterErrorKind {
  if (status === 404 || status === 410) return "not_found";
  if (status === 400) return "validation";
  if (status === 401 || status === 403) return "auth";
  return "unknown";
}
