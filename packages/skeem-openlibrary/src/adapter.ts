import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { OpenLibraryClient } from "./client.js";
import { normalizeIsbn, stripOlKey } from "./ids.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  OlAuthorSearchResponse,
  OlRecord,
  OlWorkSearchResponse,
  Schema,
} from "./types.js";

const READ_ONLY_MESSAGE = "The Open Library adapter is read-only — it supports `get`, `find`, `describe`, `discover`, and `ls` only.";

// Collection -> the API path segment its records live under. Note editions are
// fetched via /books/, not /editions/.
const GET_PATHS: Record<string, string> = {
  works: "works",
  editions: "books",
  authors: "authors",
};

const FIELDS: Record<string, Array<[string, FieldType, { required?: boolean }?]>> = {
  works: [["title", "string", { required: true }], ["description", "text"], ["subjects", "json"], ["first_publish_date", "string"], ["authors", "json"]],
  editions: [["title", "string", { required: true }], ["publish_date", "string"], ["publishers", "json"], ["number_of_pages", "integer"], ["works", "json"]],
  authors: [["name", "string", { required: true }], ["birth_date", "string"], ["death_date", "string"]],
};

/**
 * Read-only adapter over Open Library. Collections: `works`, `editions`,
 * `authors`, keyed by bare OL ids (`OL45883W` / `OL27297031M` / `OL272947A` —
 * path prefixes are stripped on input and never emitted). Authors carry
 * `remote_ids` (wikidata, viaf, imdb, goodreads, …) and editions carry
 * ISBN/OCLC/LCCN — both surface in the shared externalIds vocabulary.
 * `find editions --where isbn=…` resolves via /isbn/{isbn}.json.
 */
export function createOpenLibraryAdapter(): SkemAdapter {
  const client = new OpenLibraryClient();

  return {
    name: "openlibrary",

    async connect(config: AdapterConfig) {
      client.connect(config);
    },

    async introspect(): Promise<Schema> {
      const collections = new Map<string, Collection>();
      for (const [name, specs] of Object.entries(FIELDS)) {
        const fields = new Map<string, Field>([
          ["id", { name: "id", type: "string", required: true, unique: true }],
        ]);
        for (const [fieldName, type, opts] of specs) {
          fields.set(fieldName, { name: fieldName, type, required: opts?.required === true, unique: false });
        }
        fields.set("externalIds", { name: "externalIds", type: "json", required: false, unique: false });
        collections.set(name, { name, primaryKey: "id", fields, relations: [], uniqueConstraints: [] });
      }
      return { collections };
    },

    async get(collection: string, id: string | number, _options?: GetOptions): Promise<Record<string, unknown>> {
      const pathSegment = resolvePath(collection);
      const olId = stripOlKey(String(id))!;
      let record = await client.get<OlRecord>(`/${pathSegment}/${encodeURIComponent(olId)}.json`);

      // Merged records come back 200 with a /type/redirect body; follow one hop.
      if (record?.type?.key === "/type/redirect" && record.location) {
        record = await client.get<OlRecord>(`${record.location}.json`);
      }
      if (!record || record.type?.key === "/type/redirect") {
        throw new AdapterError(`Open Library has no ${collection.slice(0, -1)} "${olId}".`, { kind: "not_found" });
      }
      return toRecord(collection, record);
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      resolvePath(collection);

      if (options?.sort) {
        throw new AdapterError("Open Library find does not support --sort.", { kind: "validation", field: "sort" });
      }

      if (filter.id !== undefined && filter.id !== null) {
        const record = await this.get(collection, String(filter.id)).catch((error: unknown) => {
          if (error instanceof AdapterError && error.kind === "not_found") return undefined;
          throw error;
        });
        return record ? [record] : [];
      }

      if (collection === "editions") {
        if (filter.isbn === undefined || filter.isbn === null) {
          throw new AdapterError(
            "Open Library edition search supports --where isbn=<isbn10|isbn13> and --where id=<OL...M>.",
            { kind: "validation", field: "isbn" },
          );
        }
        const isbn = normalizeIsbn(filter.isbn);
        const record = await client.get<OlRecord>(`/isbn/${isbn}.json`);
        return record ? [toRecord("editions", record)] : [];
      }

      const query = filter.q ?? filter.search ?? filter.title ?? filter.name;
      if (query === undefined || query === null) {
        const hint = collection === "works" ? "title" : "name";
        throw new AdapterError(
          `Open Library find supports --where ${hint}=<text> (or q=/search=) and --where id=<OL id>.`,
          { kind: "validation", field: hint },
        );
      }

      const limit = options?.limit ?? 10;
      const offset = options?.offset ?? 0;

      if (collection === "works") {
        const response = await client.get<OlWorkSearchResponse>("/search.json", {
          q: String(query),
          fields: "key,title,first_publish_year,author_name,author_key",
          limit,
          offset,
        });
        return (response?.docs ?? []).map((doc) => ({
          id: stripOlKey(doc.key),
          title: doc.title ?? null,
          first_publish_year: doc.first_publish_year ?? null,
          author_names: doc.author_name ?? [],
          author_keys: (doc.author_key ?? []).map((key) => stripOlKey(key)),
        }));
      }

      const response = await client.get<OlAuthorSearchResponse>("/search/authors.json", {
        q: String(query),
        limit,
        offset,
      });
      return (response?.docs ?? []).map((doc) => ({
        id: stripOlKey(doc.key),
        name: doc.name ?? null,
        ...(doc.birth_date ? { birth_date: doc.birth_date } : {}),
        ...(doc.top_work ? { top_work: doc.top_work } : {}),
      }));
    },

    async count(): Promise<number | null> {
      return null;
    },

    async create(): Promise<Record<string, unknown>> {
      throw new AdapterError(READ_ONLY_MESSAGE, { kind: "unknown" });
    },

    async update(): Promise<Record<string, unknown>> {
      throw new AdapterError(READ_ONLY_MESSAGE, { kind: "unknown" });
    },

    async delete(): Promise<void> {
      throw new AdapterError(READ_ONLY_MESSAGE, { kind: "unknown" });
    },
  } satisfies SkemAdapter;
}

function resolvePath(collection: string): string {
  const pathSegment = GET_PATHS[collection];
  if (!pathSegment) {
    throw new AdapterError(
      `Open Library adapter has no collection "${collection}". Use: works, editions, authors.`,
      { kind: "not_found", collectionMissing: true },
    );
  }
  return pathSegment;
}

function toRecord(collection: string, record: OlRecord): Record<string, unknown> {
  const base: Record<string, unknown> = { id: stripOlKey(record.key) };

  if (collection === "works") {
    base.title = record.title ?? null;
    base.description = normalizeText(record.description);
    base.subjects = record.subjects ?? [];
    base.first_publish_date = record.first_publish_date ?? null;
    base.authors = (record.authors ?? [])
      .map((entry) => stripOlKey((entry as { author?: { key?: string } }).author?.key ?? (entry as { key?: string }).key))
      .filter((key): key is string => Boolean(key));
  } else if (collection === "editions") {
    base.title = record.title ?? null;
    base.publish_date = record.publish_date ?? null;
    base.publishers = record.publishers ?? [];
    base.number_of_pages = record.number_of_pages ?? null;
    base.works = (record.works ?? []).map((work) => stripOlKey(work.key)).filter(Boolean);
  } else {
    base.name = record.name ?? null;
    base.birth_date = record.birth_date ?? null;
    base.death_date = record.death_date ?? null;
    base.bio = normalizeText(record.bio);
  }

  base.externalIds = extractExternalIds(collection, record);
  return base;
}

/** Open Library text fields are either a string or { type, value }. */
function normalizeText(value: OlRecord["description"]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return value.value ?? null;
}

const REMOTE_ID_KEYS: Record<string, string> = {
  wikidata: "wikidata",
  viaf: "viaf",
  isni: "isni",
  imdb: "imdb",
  lc_naf: "lc_naf",
  librarything: "librarything",
  amazon: "amazon",
  musicbrainz: "musicbrainz_artist",
  goodreads: "goodreads_author",
};

const EDITION_IDENTIFIER_KEYS: Record<string, string> = {
  goodreads: "goodreads_book",
  librarything: "librarything",
  amazon: "amazon",
};

function extractExternalIds(collection: string, record: OlRecord): Record<string, string[]> {
  const externalIds: Record<string, string[]> = {};
  const add = (key: string, values: Array<string | undefined>) => {
    const cleaned = Array.from(new Set(values.filter((v): v is string => Boolean(v && v.length > 0))));
    if (cleaned.length > 0) {
      externalIds[key] = [...(externalIds[key] ?? []), ...cleaned];
    }
  };

  if (collection === "authors") {
    for (const [rawKey, value] of Object.entries(record.remote_ids ?? {})) {
      add(REMOTE_ID_KEYS[rawKey] ?? rawKey, [rawKey === "isni" ? value.replace(/\s+/g, "") : value]);
    }
  }

  if (collection === "editions") {
    add("isbn_10", (record.isbn_10 ?? []).map((isbn) => safeIsbn(isbn)));
    add("isbn_13", (record.isbn_13 ?? []).map((isbn) => safeIsbn(isbn)));
    add("oclc", record.oclc_numbers ?? []);
    add("lccn", record.lccn ?? []);
    for (const [rawKey, values] of Object.entries(record.identifiers ?? {})) {
      add(EDITION_IDENTIFIER_KEYS[rawKey] ?? rawKey, values);
    }
  }

  return externalIds;
}

function safeIsbn(value: string): string | undefined {
  try {
    return normalizeIsbn(value);
  } catch {
    return undefined; // skip malformed source data rather than failing the read
  }
}
