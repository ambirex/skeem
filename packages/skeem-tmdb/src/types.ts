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

// TMDB v3 API shapes (read-only subset).

export interface TmdbExternalIds {
  imdb_id?: string | null;
  wikidata_id?: string | null;
  tvdb_id?: number | null;
  facebook_id?: string | null;
  instagram_id?: string | null;
  twitter_id?: string | null;
}

export interface TmdbEntity {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  biography?: string;
  birthday?: string | null;
  known_for_department?: string;
  vote_average?: number;
  imdb_id?: string | null;
  external_ids?: TmdbExternalIds;
}

export interface TmdbSearchResponse {
  page?: number;
  results?: TmdbEntity[];
  total_results?: number;
}

export interface TmdbFindResponse {
  movie_results?: TmdbEntity[];
  tv_results?: TmdbEntity[];
  person_results?: TmdbEntity[];
}

export interface TmdbErrorBody {
  status_code?: number;
  status_message?: string;
  success?: boolean;
}

export class TmdbRequestError extends AdapterError {
  constructor(message: string, status: number, statusCode?: number) {
    super(message, {
      status,
      code: statusCode !== undefined ? String(statusCode) : undefined,
      kind: tmdbErrorKind(status, statusCode),
      collectionMissing: false,
    });
    this.name = "TmdbRequestError";
  }
}

function tmdbErrorKind(status: number, statusCode?: number): AdapterErrorKind {
  // TMDB's own status codes are more precise than the HTTP status:
  // 7 = invalid API key, 10 = suspended key, 34 = resource not found.
  if (statusCode === 7 || statusCode === 10) return "auth";
  if (statusCode === 34 || status === 404) return "not_found";
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 422) return "validation";
  return "unknown";
}
