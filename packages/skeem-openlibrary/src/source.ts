import {
  OpenLibraryRequestError,
  type OpenLibrarySourceConfig,
  type OpenLibrarySourceSchema,
} from "./types.js";

const DEFAULT_BASE_URL = "https://openlibrary.org";
const DEFAULT_USER_AGENT = "skeem-openlibrary/0.1.0 (+https://github.com/ambirex/skeem)";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type FetchLike = typeof fetch;

const SCHEMA: OpenLibrarySourceSchema = {
  source: "openlibrary",
  description: "Open Library — read-only access to works, editions, and search.",
  collections: [
    {
      name: "works",
      description: "Abstract book works keyed by OLID (e.g. OL45804W).",
      primaryKey: "id",
      searchable: true,
      fields: [
        { name: "id", type: "string", description: "Open Library work id (OLID)." },
        { name: "title", type: "string" },
        { name: "first_publish_year", type: "integer" },
        { name: "authors", type: "json", description: "Array of { id, name } author refs." },
        { name: "subjects", type: "json" },
        { name: "edition_count", type: "integer" },
      ],
    },
    {
      name: "editions",
      description: "Specific printings/editions keyed by OLID (e.g. OL7353617M).",
      primaryKey: "id",
      searchable: false,
      fields: [
        { name: "id", type: "string", description: "Open Library edition id (OLID)." },
        { name: "title", type: "string" },
        { name: "isbn_10", type: "json" },
        { name: "isbn_13", type: "json" },
        { name: "publish_date", type: "string" },
        { name: "number_of_pages", type: "integer" },
        { name: "publishers", type: "json" },
        { name: "work_id", type: "string", description: "OLID of the parent work, if linked." },
      ],
    },
  ],
};

const SUPPORTED_COLLECTIONS = new Set(SCHEMA.collections.map((collection) => collection.name));

interface ResolvedConnection {
  baseUrl: string;
  userAgent: string;
}

export function createOpenLibrarySource() {
  let resolved: ResolvedConnection | undefined;
  let fetchImpl: FetchLike | undefined;

  return {
    name: "openlibrary",
    kind: "read_source" as const,

    async connect(config: OpenLibrarySourceConfig): Promise<void> {
      const baseUrl = pickString(config.base_url, config.baseUrl) ?? DEFAULT_BASE_URL;
      const userAgent = pickString(config.user_agent, config.userAgent) ?? DEFAULT_USER_AGENT;

      try {
        // Throws if base_url is not a parseable absolute URL.
        new URL(baseUrl);
      } catch {
        throw new OpenLibraryRequestError(
          `Open Library base URL must be a parseable absolute URL (received "${baseUrl}").`,
          0,
          "openlibrary.invalid_base_url",
        );
      }

      resolved = { baseUrl: stripTrailingSlash(baseUrl), userAgent };

      const fetchOverride = config.fetch;
      fetchImpl = typeof fetchOverride === "function" ? fetchOverride : globalThis.fetch;

      if (typeof fetchImpl !== "function") {
        throw new OpenLibraryRequestError(
          "Global fetch is not available in this runtime; pass a fetch override in source config.",
          0,
          "openlibrary.no_fetch",
        );
      }
    },

    describe(): OpenLibrarySourceSchema {
      return cloneSchema(SCHEMA);
    },

    async get(collection: string, id: string | number): Promise<Record<string, unknown>> {
      assertSupportedCollection(collection);
      const auth = ensureConnected(resolved);
      const fetcher = ensureFetch(fetchImpl);
      const olid = String(id).trim();
      assertNonEmptyOlid(olid);

      const path = collection === "works" ? `/works/${encodeURIComponent(olid)}.json` : `/books/${encodeURIComponent(olid)}.json`;
      const response = await fetcher(buildUrl(auth, path), buildRequestInit(auth));
      if (!response.ok) {
        throw await openLibraryError(response, `Failed to fetch ${collection}:${olid}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      return collection === "works" ? projectWork(body) : projectEdition(body);
    },

    async find(
      collection: string,
      filter: Record<string, unknown>,
      options?: { limit?: number; offset?: number },
    ): Promise<Record<string, unknown>[]> {
      assertSupportedCollection(collection);
      if (collection !== "works") {
        throw new OpenLibraryRequestError(
          `Open Library find is only supported on "works" right now (use get with an OLID for editions).`,
          0,
          "openlibrary.find_unsupported_collection",
        );
      }
      const auth = ensureConnected(resolved);
      const fetcher = ensureFetch(fetchImpl);

      const query = pickString(filter.query, filter.q);
      if (!query) {
        throw new OpenLibraryRequestError(
          'Open Library find requires a "query" filter (e.g. --where query=Inception).',
          0,
          "openlibrary.missing_query",
        );
      }

      const limit = clampLimit(options?.limit);
      const offset = Math.max(0, options?.offset ?? 0);
      const explicitPage = parseOptionalPositiveInt(filter.page);
      const startPage = explicitPage ?? Math.floor(offset / limit) + 1;
      let skipFromFirstPage = explicitPage ? 0 : offset % limit;

      const collected: Record<string, unknown>[] = [];
      let page = startPage;

      while (collected.length < limit) {
        const response = await fetcher(
          buildUrl(auth, "/search.json", {
            q: query,
            page: String(page),
            limit: String(limit),
          }),
          buildRequestInit(auth),
        );
        if (!response.ok) {
          throw await openLibraryError(response, `Failed to search ${collection}`);
        }
        const body = (await response.json()) as {
          numFound?: number;
          start?: number;
          docs?: Array<Record<string, unknown>>;
        };
        const docs = (body.docs ?? []).filter((doc) => isWorkDoc(doc.key));
        const sliced = docs.slice(skipFromFirstPage);
        skipFromFirstPage = 0;
        for (const doc of sliced) {
          if (collected.length >= limit) break;
          collected.push(projectSearchDoc(doc));
        }
        if (explicitPage) break;
        if ((body.docs ?? []).length === 0) break;
        const totalReturnedSoFar = page * limit;
        if (typeof body.numFound === "number" && totalReturnedSoFar >= body.numFound) break;
        page += 1;
      }

      return collected;
    },
  };
}

function buildRequestInit(auth: ResolvedConnection): RequestInit {
  return {
    headers: {
      Accept: "application/json",
      "User-Agent": auth.userAgent,
    },
  };
}

function buildUrl(auth: ResolvedConnection, path: string, params?: Record<string, string>): string {
  const url = new URL(`${auth.baseUrl}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
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

function ensureConnected(resolved: ResolvedConnection | undefined): ResolvedConnection {
  if (!resolved) {
    throw new OpenLibraryRequestError(
      "Open Library source must be connected before use.",
      0,
      "openlibrary.not_connected",
    );
  }
  return resolved;
}

function ensureFetch(impl: FetchLike | undefined): FetchLike {
  if (typeof impl !== "function") {
    throw new OpenLibraryRequestError(
      "Open Library source has no fetch implementation.",
      0,
      "openlibrary.no_fetch",
    );
  }
  return impl;
}

function clampLimit(input?: number): number {
  if (input === undefined || !Number.isFinite(input)) {
    return DEFAULT_PAGE_SIZE;
  }
  if (input <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(input), MAX_PAGE_SIZE);
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.floor(parsed);
}

function assertSupportedCollection(collection: string): void {
  if (!SUPPORTED_COLLECTIONS.has(collection)) {
    throw new OpenLibraryRequestError(
      `Open Library source does not expose collection "${collection}" yet (supported: ${[...SUPPORTED_COLLECTIONS].join(", ")}).`,
      0,
      "openlibrary.unknown_collection",
    );
  }
}

function assertNonEmptyOlid(olid: string): void {
  if (olid.length === 0) {
    throw new OpenLibraryRequestError(
      "Open Library get requires a non-empty OLID.",
      0,
      "openlibrary.missing_olid",
    );
  }
}

function isWorkDoc(key: unknown): boolean {
  return typeof key === "string" && key.startsWith("/works/");
}

function olidFromKey(key: unknown, prefix: string): string | undefined {
  if (typeof key !== "string") return undefined;
  if (!key.startsWith(prefix)) return undefined;
  const tail = key.slice(prefix.length);
  return tail.length > 0 ? tail : undefined;
}

function parseFirstPublishYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const match = value.match(/(\d{4})/);
    if (match) {
      return Number.parseInt(match[1]!, 10);
    }
  }
  return undefined;
}

function projectAuthors(value: unknown): Array<{ id?: string; name?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: Array<{ id?: string; name?: string }> = [];
  for (const entry of value) {
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const author = record.author && typeof record.author === "object" ? (record.author as Record<string, unknown>) : record;
      const id = olidFromKey(author.key ?? record.key, "/authors/");
      const name = typeof author.name === "string" ? author.name : typeof record.name === "string" ? record.name : undefined;
      if (id || name) {
        result.push({ ...(id ? { id } : {}), ...(name ? { name } : {}) });
      }
    }
  }
  return result.length > 0 ? result : undefined;
}

function projectAuthorsFromSearchDoc(doc: Record<string, unknown>): Array<{ id?: string; name?: string }> | undefined {
  const names = Array.isArray(doc.author_name) ? (doc.author_name as unknown[]) : undefined;
  const keys = Array.isArray(doc.author_key) ? (doc.author_key as unknown[]) : undefined;
  if (!names && !keys) return undefined;
  const length = Math.max(names?.length ?? 0, keys?.length ?? 0);
  const result: Array<{ id?: string; name?: string }> = [];
  for (let index = 0; index < length; index += 1) {
    const name = typeof names?.[index] === "string" ? (names[index] as string) : undefined;
    const id = typeof keys?.[index] === "string" ? (keys[index] as string) : undefined;
    if (id || name) {
      result.push({ ...(id ? { id } : {}), ...(name ? { name } : {}) });
    }
  }
  return result.length > 0 ? result : undefined;
}

function projectWork(row: Record<string, unknown>): Record<string, unknown> {
  const id = olidFromKey(row.key, "/works/") ?? (typeof row.key === "string" ? row.key : undefined);
  const authors = projectAuthors(row.authors);
  const year = parseFirstPublishYear(row.first_publish_date);
  return {
    id,
    title: typeof row.title === "string" ? row.title : undefined,
    ...(year !== undefined ? { first_publish_year: year } : {}),
    ...(authors ? { authors } : {}),
    ...(Array.isArray(row.subjects) ? { subjects: row.subjects } : {}),
  };
}

function projectEdition(row: Record<string, unknown>): Record<string, unknown> {
  const id = olidFromKey(row.key, "/books/") ?? (typeof row.key === "string" ? row.key : undefined);
  const works = Array.isArray(row.works) ? row.works : undefined;
  const workKey = works && works[0] && typeof works[0] === "object" ? (works[0] as Record<string, unknown>).key : undefined;
  const workId = olidFromKey(workKey, "/works/");
  return {
    id,
    title: typeof row.title === "string" ? row.title : undefined,
    ...(Array.isArray(row.isbn_10) ? { isbn_10: row.isbn_10 } : {}),
    ...(Array.isArray(row.isbn_13) ? { isbn_13: row.isbn_13 } : {}),
    ...(typeof row.publish_date === "string" ? { publish_date: row.publish_date } : {}),
    ...(typeof row.number_of_pages === "number" ? { number_of_pages: row.number_of_pages } : {}),
    ...(Array.isArray(row.publishers) ? { publishers: row.publishers } : {}),
    ...(workId ? { work_id: workId } : {}),
  };
}

function projectSearchDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const id = olidFromKey(doc.key, "/works/");
  const authors = projectAuthorsFromSearchDoc(doc);
  const editionCount = typeof doc.edition_count === "number" ? doc.edition_count : undefined;
  return {
    id,
    title: typeof doc.title === "string" ? doc.title : undefined,
    ...(typeof doc.first_publish_year === "number" ? { first_publish_year: doc.first_publish_year } : {}),
    ...(authors ? { authors } : {}),
    ...(Array.isArray(doc.subject) ? { subjects: doc.subject } : {}),
    ...(editionCount !== undefined ? { edition_count: editionCount } : {}),
  };
}

function cloneSchema(schema: OpenLibrarySourceSchema): OpenLibrarySourceSchema {
  return {
    source: schema.source,
    ...(schema.description ? { description: schema.description } : {}),
    collections: schema.collections.map((collection) => ({
      ...collection,
      fields: collection.fields.map((field) => ({ ...field })),
    })),
  };
}

async function openLibraryError(response: Response, fallback: string): Promise<OpenLibraryRequestError> {
  let message = fallback;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.error === "string") {
      message = body.error;
    }
    details = body;
  } catch {
    if (response.status === 404) {
      message = `${fallback}: not found`;
    }
  }
  return new OpenLibraryRequestError(message, response.status, `openlibrary.${response.status}`, details);
}
