import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { CrossRefClient } from "./client.js";
import { encodeDoiPath, normalizeDoi, normalizeOrcid } from "./doi.js";
import type {
  AdapterConfig,
  Collection,
  CrossRefListResponse,
  CrossRefWork,
  CrossRefWorkResponse,
  Field,
  FindOptions,
  GetOptions,
  Schema,
} from "./types.js";

const READ_ONLY_MESSAGE = "The CrossRef adapter is read-only — it supports `get`, `find`, `describe`, `discover`, and `ls` only.";

/**
 * Read-only adapter over the CrossRef REST API. One collection — `works` —
 * keyed by the lowercase DOI. `get` returns title/authors (with bare ORCIDs)
 * and surfaces ORCIDs, funder DOIs, ISSN/ISBN in the shared externalIds
 * vocabulary. `find` searches bibliographically and supports a real reverse
 * pivot by ORCID (`--where orcid=…`). Funder ids ride along in externalIds —
 * there is no separate funders collection (yet).
 */
export function createCrossRefAdapter(): SkemAdapter {
  const client = new CrossRefClient();

  return {
    name: "crossref",

    async connect(config: AdapterConfig) {
      client.connect(config);
    },

    async introspect(): Promise<Schema> {
      const fields = new Map<string, Field>([
        ["id", { name: "id", type: "string", required: true, unique: true }],
        ["title", { name: "title", type: "string", required: false, unique: false }],
        ["type", { name: "type", type: "string", required: false, unique: false }],
        ["container_title", { name: "container_title", type: "string", required: false, unique: false }],
        ["publisher", { name: "publisher", type: "string", required: false, unique: false }],
        ["issued", { name: "issued", type: "string", required: false, unique: false }],
        ["authors", { name: "authors", type: "json", required: false, unique: false }],
        ["externalIds", { name: "externalIds", type: "json", required: false, unique: false }],
      ]);
      const collections = new Map<string, Collection>([
        ["works", { name: "works", primaryKey: "id", fields, relations: [], uniqueConstraints: [] }],
      ]);
      return { collections };
    },

    async get(collection: string, id: string | number, _options?: GetOptions): Promise<Record<string, unknown>> {
      requireWorks(collection);
      const doi = normalizeDoi(String(id));
      const response = await client.get<CrossRefWorkResponse>(`/works/${encodeDoiPath(doi)}`);
      return toRecord(response.message);
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      requireWorks(collection);

      if (options?.sort) {
        throw new AdapterError("CrossRef find does not support --sort.", { kind: "validation", field: "sort" });
      }

      if (filter.doi !== undefined && filter.doi !== null) {
        const record = await this.get(collection, String(filter.doi)).catch((error: unknown) => {
          if (error instanceof AdapterError && error.kind === "not_found") return undefined;
          throw error;
        });
        return record ? [toSummary(record)] : [];
      }

      const query: Record<string, string | number> = {
        rows: options?.limit ?? 10,
        offset: options?.offset ?? 0,
      };
      const filters: string[] = [];

      const bibliographic = filter.title ?? filter.q ?? filter.search;
      if (bibliographic !== undefined && bibliographic !== null) {
        query["query.bibliographic"] = String(bibliographic);
      }
      if (filter.author !== undefined && filter.author !== null) {
        query["query.author"] = String(filter.author);
      }
      if (filter.orcid !== undefined && filter.orcid !== null) {
        filters.push(`orcid:${normalizeOrcid(String(filter.orcid))}`);
      }
      if (filter.issn !== undefined && filter.issn !== null) {
        filters.push(`issn:${String(filter.issn)}`);
      }
      if (filters.length > 0) {
        query.filter = filters.join(",");
      }

      if (!("query.bibliographic" in query) && !("query.author" in query) && filters.length === 0) {
        throw new AdapterError(
          "CrossRef find supports --where title=<text> (or q=/search=/author=), --where orcid=<orcid>, --where issn=<issn>, and --where doi=<doi>.",
          { kind: "validation", field: "title" },
        );
      }

      const response = await client.get<CrossRefListResponse>("/works", query);
      return (response.message.items ?? []).map((work) => toSummary(toRecord(work)));
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

function requireWorks(collection: string): void {
  if (collection !== "works") {
    throw new AdapterError(
      `CrossRef adapter has no collection "${collection}". Use "works" (keyed by DOI).`,
      { kind: "not_found", collectionMissing: true },
    );
  }
}

function toRecord(work: CrossRefWork): Record<string, unknown> {
  const authors = (work.author ?? []).map((author) => ({
    name: author.name ?? [author.given, author.family].filter(Boolean).join(" "),
    ...(author.ORCID ? { orcid: normalizeOrcid(author.ORCID) } : {}),
  }));

  return {
    id: work.DOI.toLowerCase(),
    title: work.title?.[0] ?? null,
    type: work.type ?? null,
    container_title: work["container-title"]?.[0] ?? null,
    publisher: work.publisher ?? null,
    issued: formatIssued(work.issued),
    authors,
    externalIds: extractExternalIds(work, authors),
  };
}

function toSummary(record: Record<string, unknown>): Record<string, unknown> {
  const { authors: _authors, externalIds: _externalIds, publisher: _publisher, ...summary } = record;
  return summary;
}

/** CrossRef dates are partial ("2014", "2014-02"); keep them as strings. */
function formatIssued(issued: CrossRefWork["issued"]): string | null {
  const parts = issued?.["date-parts"]?.[0];
  if (!parts || parts.length === 0) return null;
  return parts
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-");
}

function extractExternalIds(
  work: CrossRefWork,
  authors: Array<{ orcid?: string }>,
): Record<string, string[]> {
  const externalIds: Record<string, string[]> = {};
  const add = (key: string, values: Array<string | undefined>) => {
    const cleaned = Array.from(new Set(values.filter((v): v is string => Boolean(v && v.length > 0))));
    if (cleaned.length > 0) {
      externalIds[key] = cleaned;
    }
  };

  // Record-level flattening is lossy on purpose; the authors array keeps the
  // ORCID-to-author association.
  add("orcid", authors.map((author) => author.orcid));
  add("funder_doi", (work.funder ?? []).map((funder) => funder.DOI?.toLowerCase()));
  add("issn", work.ISSN ?? []);

  const isbns = (work.ISBN ?? []).map((isbn) => isbn.replace(/[-\s]/g, ""));
  add("isbn_13", isbns.filter((isbn) => isbn.length === 13));
  add("isbn_10", isbns.filter((isbn) => isbn.length === 10));

  return externalIds;
}
