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

// MusicBrainz WS/2 JSON shapes (read-only subset).

export interface MbUrlRelation {
  type?: string;
  ended?: boolean;
  url?: { resource?: string };
}

export interface MbEntity {
  id: string;
  name?: string;
  title?: string;
  type?: string | null;
  disambiguation?: string;
  country?: string | null;
  barcode?: string | null;
  status?: string | null;
  date?: string;
  length?: number | null;
  score?: number;
  isnis?: string[];
  "sort-name"?: string;
  "first-release-date"?: string;
  "label-code"?: number | null;
  relations?: MbUrlRelation[];
}

export interface MbSearchResponse {
  count?: number;
  artists?: MbEntity[];
  "release-groups"?: MbEntity[];
  releases?: MbEntity[];
  recordings?: MbEntity[];
  works?: MbEntity[];
  labels?: MbEntity[];
  error?: string;
}

export class MusicBrainzRequestError extends AdapterError {
  constructor(message: string, status: number) {
    super(message, {
      status,
      kind: musicbrainzErrorKind(status),
      collectionMissing: false,
    });
    this.name = "MusicBrainzRequestError";
  }
}

function musicbrainzErrorKind(status: number): AdapterErrorKind {
  if (status === 404) return "not_found";
  if (status === 400) return "validation";
  if (status === 401 || status === 403) return "auth";
  return "unknown";
}
