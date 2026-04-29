import { TmdbRequestError, type TmdbSourceConfig, type TmdbSourceSchema } from "./types.js";

const DEFAULT_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_PAGE_SIZE = 20;

type FetchLike = typeof fetch;

const SCHEMA: TmdbSourceSchema = {
  source: "tmdb",
  description: "The Movie Database (TMDB) — read-only access to movies, search, and credits.",
  collections: [
    {
      name: "movies",
      description: "Movies addressable by TMDB id.",
      primaryKey: "id",
      searchable: true,
      fields: [
        { name: "id", type: "integer", description: "TMDB movie id." },
        { name: "title", type: "string" },
        { name: "original_title", type: "string" },
        { name: "release_date", type: "date" },
        { name: "overview", type: "text" },
        { name: "popularity", type: "float" },
        { name: "vote_average", type: "float" },
        { name: "vote_count", type: "integer" },
        { name: "original_language", type: "string" },
      ],
    },
  ],
};

const SUPPORTED_COLLECTIONS = new Set(SCHEMA.collections.map((collection) => collection.name));

interface ResolvedAuth {
  baseUrl: string;
  apiKey?: string;
  bearer?: string;
}

export function createTmdbSource() {
  let resolved: ResolvedAuth | undefined;
  let fetchImpl: FetchLike | undefined;

  return {
    name: "tmdb",
    kind: "read_source" as const,

    async connect(config: TmdbSourceConfig): Promise<void> {
      const apiKey = pickString(config.api_key, config.apiKey);
      const bearer = pickString(config.read_token, config.readToken);
      if (!apiKey && !bearer) {
        throw new TmdbRequestError(
          "TMDB source requires either api_key or read_token.",
          0,
          "tmdb.missing_credentials",
        );
      }

      const baseUrl = pickString(config.base_url, config.baseUrl) ?? DEFAULT_BASE_URL;
      resolved = {
        baseUrl: stripTrailingSlash(baseUrl),
        ...(apiKey ? { apiKey } : {}),
        ...(bearer ? { bearer } : {}),
      };

      const fetchOverride = config.fetch;
      fetchImpl = typeof fetchOverride === "function"
        ? fetchOverride
        : globalThis.fetch;

      if (typeof fetchImpl !== "function") {
        throw new TmdbRequestError(
          "Global fetch is not available in this runtime; pass a fetch override in source config.",
          0,
          "tmdb.no_fetch",
        );
      }
    },

    describe(): TmdbSourceSchema {
      return cloneSchema(SCHEMA);
    },

    async get(collection: string, id: string | number): Promise<Record<string, unknown>> {
      assertSupportedCollection(collection);
      const auth = ensureConnected(resolved);
      const fetcher = ensureFetch(fetchImpl);

      const response = await fetcher(buildUrl(auth, `/movie/${encodeURIComponent(String(id))}`), buildRequestInit(auth));
      if (!response.ok) {
        throw await tmdbError(response, `Failed to fetch ${collection}:${id}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      return projectMovie(body);
    },

    async find(
      collection: string,
      filter: Record<string, unknown>,
      options?: { limit?: number; offset?: number },
    ): Promise<Record<string, unknown>[]> {
      assertSupportedCollection(collection);
      const auth = ensureConnected(resolved);
      const fetcher = ensureFetch(fetchImpl);

      const query = pickString(filter.query, filter.q);
      if (!query) {
        throw new TmdbRequestError(
          'TMDB find requires a "query" filter (e.g. --where query=Inception).',
          0,
          "tmdb.missing_query",
        );
      }

      const limit = clampLimit(options?.limit);
      const offset = Math.max(0, options?.offset ?? 0);
      const startPage = Math.floor(offset / TMDB_PAGE_SIZE) + 1;
      const startSkip = offset % TMDB_PAGE_SIZE;
      const explicitPage = parseOptionalPositiveInt(filter.page);

      const collected: Record<string, unknown>[] = [];
      let page = explicitPage ?? startPage;
      let skipFromFirstPage = explicitPage ? 0 : startSkip;
      let totalPages = 1;

      while (collected.length < limit) {
        const response = await fetcher(
          buildUrl(auth, "/search/movie", { query, page: String(page) }),
          buildRequestInit(auth),
        );
        if (!response.ok) {
          throw await tmdbError(response, `Failed to search ${collection}`);
        }
        const body = (await response.json()) as {
          page?: number;
          results?: Array<Record<string, unknown>>;
          total_pages?: number;
          total_results?: number;
        };
        totalPages = body.total_pages ?? page;
        const rows = (body.results ?? []).slice(skipFromFirstPage);
        skipFromFirstPage = 0;
        for (const row of rows) {
          if (collected.length >= limit) break;
          collected.push(projectMovie(row));
        }
        if (page >= totalPages || (body.results ?? []).length === 0 || explicitPage) {
          break;
        }
        page += 1;
      }

      return collected;
    },
  };
}

function buildRequestInit(auth: ResolvedAuth): RequestInit {
  const init: RequestInit = {};
  if (auth.bearer) {
    init.headers = { Authorization: `Bearer ${auth.bearer}`, Accept: "application/json" };
  } else {
    init.headers = { Accept: "application/json" };
  }
  return init;
}

function buildUrl(auth: ResolvedAuth, path: string, params?: Record<string, string>): string {
  const url = new URL(`${auth.baseUrl}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  if (auth.apiKey && !auth.bearer) {
    url.searchParams.set("api_key", auth.apiKey);
  }
  return url.toString();
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function ensureConnected(resolved: ResolvedAuth | undefined): ResolvedAuth {
  if (!resolved) {
    throw new TmdbRequestError("TMDB source must be connected before use.", 0, "tmdb.not_connected");
  }
  return resolved;
}

function ensureFetch(impl: FetchLike | undefined): FetchLike {
  if (typeof impl !== "function") {
    throw new TmdbRequestError("TMDB source has no fetch implementation.", 0, "tmdb.no_fetch");
  }
  return impl;
}

function clampLimit(input?: number): number {
  if (input === undefined || !Number.isFinite(input)) {
    return TMDB_PAGE_SIZE;
  }
  if (input <= 0) {
    return TMDB_PAGE_SIZE;
  }
  return Math.min(Math.floor(input), 100);
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.floor(parsed);
}

function assertSupportedCollection(collection: string): void {
  if (!SUPPORTED_COLLECTIONS.has(collection)) {
    throw new TmdbRequestError(
      `TMDB source does not expose collection "${collection}" yet (supported: ${[...SUPPORTED_COLLECTIONS].join(", ")}).`,
      0,
      "tmdb.unknown_collection",
    );
  }
}

function projectMovie(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    original_title: row.original_title,
    release_date: row.release_date,
    overview: row.overview,
    popularity: row.popularity,
    vote_average: row.vote_average,
    vote_count: row.vote_count,
    original_language: row.original_language,
  };
}

function cloneSchema(schema: TmdbSourceSchema): TmdbSourceSchema {
  return {
    source: schema.source,
    ...(schema.description ? { description: schema.description } : {}),
    collections: schema.collections.map((collection) => ({
      ...collection,
      fields: collection.fields.map((field) => ({ ...field })),
    })),
  };
}

async function tmdbError(response: Response, fallback: string): Promise<TmdbRequestError> {
  let message = fallback;
  let code: string | undefined;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as { status_message?: string; status_code?: number };
    if (body.status_message) {
      message = body.status_message;
    }
    if (typeof body.status_code === "number") {
      code = `tmdb.${body.status_code}`;
    }
    details = body as Record<string, unknown>;
  } catch {
    // ignore — fall back to defaults
  }
  return new TmdbRequestError(message, response.status, code, details);
}
