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

// CrossRef REST API shapes (read-only subset).

export interface CrossRefWork {
  DOI: string;
  type?: string;
  title?: string[];
  "container-title"?: string[];
  publisher?: string;
  issued?: { "date-parts"?: number[][] };
  author?: Array<{ given?: string; family?: string; name?: string; ORCID?: string }>;
  funder?: Array<{ name?: string; DOI?: string; award?: string[] }>;
  ISSN?: string[];
  ISBN?: string[];
}

export interface CrossRefWorkResponse {
  status?: string;
  message: CrossRefWork;
}

export interface CrossRefListResponse {
  status?: string;
  message: {
    "total-results"?: number;
    items?: CrossRefWork[];
  };
}

export class CrossRefRequestError extends AdapterError {
  constructor(message: string, status: number) {
    super(message, {
      status,
      kind: crossRefErrorKind(status),
      collectionMissing: false,
    });
    this.name = "CrossRefRequestError";
  }
}

function crossRefErrorKind(status: number): AdapterErrorKind {
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "validation";
  if (status === 401 || status === 403) return "auth";
  return "unknown";
}
