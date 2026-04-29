import {
  WikidataRequestError,
  type WikidataSourceConfig,
  type WikidataSourceSchema,
} from "./types.js";

const DEFAULT_BASE_URL = "https://www.wikidata.org";
const DEFAULT_USER_AGENT = "skeem-wikidata/0.1.0 (+https://github.com/ambirex/skeem)";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const OVERALL_LIMIT_CAP = 200;
const QID_PATTERN = /^Q\d+$/;

type FetchLike = typeof fetch;

interface ExternalIdProperty {
  key: string;
  property: string;
  description: string;
}

const EXTERNAL_ID_PROPERTIES: ExternalIdProperty[] = [
  { key: "tmdb_movie_id", property: "P4947", description: "TMDB movie id" },
  { key: "tmdb_tv_id", property: "P4983", description: "TMDB TV series id" },
  { key: "tmdb_person_id", property: "P4985", description: "TMDB person id" },
  { key: "imdb_id", property: "P345", description: "IMDb id (movies, people, episodes)" },
  { key: "openlibrary_work_id", property: "P648", description: "Open Library work OLID" },
  { key: "openlibrary_edition_id", property: "P5331", description: "Open Library edition OLID" },
  { key: "isbn_13", property: "P212", description: "ISBN-13" },
  { key: "isbn_10", property: "P957", description: "ISBN-10" },
  { key: "musicbrainz_artist_id", property: "P434", description: "MusicBrainz artist id" },
  { key: "musicbrainz_work_id", property: "P435", description: "MusicBrainz work id" },
  { key: "musicbrainz_release_group_id", property: "P436", description: "MusicBrainz release-group id" },
  { key: "musicbrainz_recording_id", property: "P4404", description: "MusicBrainz recording id" },
  { key: "doi", property: "P356", description: "Digital Object Identifier" },
  { key: "orcid", property: "P496", description: "ORCID iD" },
  { key: "pubmed_id", property: "P698", description: "PubMed id" },
  { key: "arxiv_id", property: "P818", description: "arXiv id" },
  { key: "viaf_id", property: "P214", description: "VIAF id" },
  { key: "library_of_congress_id", property: "P244", description: "Library of Congress authority id" },
  { key: "geonames_id", property: "P1566", description: "GeoNames id" },
  { key: "osm_relation_id", property: "P402", description: "OpenStreetMap relation id" },
  { key: "freebase_id", property: "P646", description: "Freebase id (legacy)" },
  { key: "sec_cik", property: "P5531", description: "SEC Central Index Key" },
];

const SCHEMA: WikidataSourceSchema = {
  source: "wikidata",
  description: "Wikidata — universal cross-provider identity hub keyed by Q-ID.",
  collections: [
    {
      name: "entities",
      description: "Wikidata items (Q-IDs) with curated external-ID projections.",
      primaryKey: "id",
      searchable: true,
      fields: [
        { name: "id", type: "string", description: "Wikidata Q-ID (e.g. Q42)." },
        { name: "label", type: "string" },
        { name: "description", type: "string" },
        { name: "aliases", type: "json" },
        { name: "instance_of", type: "json", description: "Array of P31 target Q-IDs." },
        { name: "external_ids", type: "json", description: "Curated map of foreign-system identifiers." },
        { name: "wikipedia", type: "json", description: "Site-specific Wikipedia titles by site key." },
      ],
    },
  ],
  external_id_properties: EXTERNAL_ID_PROPERTIES.map((entry) => ({ ...entry })),
};

const SUPPORTED_COLLECTIONS = new Set(SCHEMA.collections.map((collection) => collection.name));

interface ResolvedConnection {
  baseUrl: string;
  userAgent: string;
  language: string;
}

export function createWikidataSource() {
  let resolved: ResolvedConnection | undefined;
  let fetchImpl: FetchLike | undefined;

  return {
    name: "wikidata",
    kind: "read_source" as const,

    async connect(config: WikidataSourceConfig): Promise<void> {
      const baseUrl = pickString(config.base_url, config.baseUrl) ?? DEFAULT_BASE_URL;
      const userAgent = pickString(config.user_agent, config.userAgent) ?? DEFAULT_USER_AGENT;
      const language = pickString(config.language) ?? DEFAULT_LANGUAGE;

      try {
        new URL(baseUrl);
      } catch {
        throw new WikidataRequestError(
          `Wikidata base URL must be a parseable absolute URL (received "${baseUrl}").`,
          0,
          "wikidata.invalid_base_url",
        );
      }

      resolved = { baseUrl: stripTrailingSlash(baseUrl), userAgent, language };

      const fetchOverride = config.fetch;
      fetchImpl = typeof fetchOverride === "function" ? fetchOverride : globalThis.fetch;

      if (typeof fetchImpl !== "function") {
        throw new WikidataRequestError(
          "Global fetch is not available in this runtime; pass a fetch override in source config.",
          0,
          "wikidata.no_fetch",
        );
      }
    },

    describe(): WikidataSourceSchema {
      return cloneSchema(SCHEMA);
    },

    async get(collection: string, id: string | number): Promise<Record<string, unknown>> {
      assertSupportedCollection(collection);
      const auth = ensureConnected(resolved);
      const fetcher = ensureFetch(fetchImpl);
      const qid = String(id).trim();
      assertValidQid(qid);

      const response = await fetcher(
        buildUrl(auth, `/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`),
        buildRequestInit(auth),
      );
      if (!response.ok) {
        throw await wikidataError(response, `Failed to fetch ${collection}:${qid}`);
      }
      const body = (await response.json()) as { entities?: Record<string, RawEntity> };
      const entity = body.entities?.[qid];
      if (!entity) {
        throw new WikidataRequestError(
          `Wikidata entity ${qid} was not present in the response.`,
          response.status,
          "wikidata.entity_missing",
        );
      }
      return projectEntity(entity, auth.language);
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
        throw new WikidataRequestError(
          'Wikidata find requires a "query" filter (e.g. --where query="Douglas Adams").',
          0,
          "wikidata.missing_query",
        );
      }

      const limit = clampLimit(options?.limit);
      const offset = Math.max(0, options?.offset ?? 0);
      const language = pickString(filter.language) ?? auth.language;
      const collected: Record<string, unknown>[] = [];
      let cursor = offset;

      while (collected.length < limit) {
        const response = await fetcher(
          buildUrl(auth, "/w/api.php", {
            action: "wbsearchentities",
            search: query,
            language,
            format: "json",
            limit: String(Math.min(limit - collected.length, MAX_PAGE_SIZE)),
            continue: String(cursor),
            origin: "*",
          }),
          buildRequestInit(auth),
        );
        if (!response.ok) {
          throw await wikidataError(response, `Failed to search ${collection}`);
        }
        const body = (await response.json()) as {
          search?: Array<RawSearchHit>;
          ["search-continue"]?: number;
          success?: number;
        };
        const hits = body.search ?? [];
        for (const hit of hits) {
          if (collected.length >= limit) break;
          collected.push(projectSearchHit(hit));
        }
        if (hits.length === 0) break;
        if (typeof body["search-continue"] !== "number") break;
        cursor = body["search-continue"];
      }

      return collected;
    },
  };
}

interface RawClaimSnak {
  snaktype?: string;
  datatype?: string;
  datavalue?: {
    type?: string;
    value?: unknown;
  };
}

interface RawClaim {
  mainsnak?: RawClaimSnak;
  rank?: string;
}

interface RawEntity {
  type?: string;
  id?: string;
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  aliases?: Record<string, Array<{ value?: string }>>;
  claims?: Record<string, RawClaim[]>;
  sitelinks?: Record<string, { site?: string; title?: string; url?: string }>;
}

interface RawSearchHit {
  id?: string;
  label?: string;
  description?: string;
  aliases?: string[];
  match?: { type?: string; text?: string };
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
    throw new WikidataRequestError(
      "Wikidata source must be connected before use.",
      0,
      "wikidata.not_connected",
    );
  }
  return resolved;
}

function ensureFetch(impl: FetchLike | undefined): FetchLike {
  if (typeof impl !== "function") {
    throw new WikidataRequestError(
      "Wikidata source has no fetch implementation.",
      0,
      "wikidata.no_fetch",
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
  return Math.min(Math.floor(input), OVERALL_LIMIT_CAP);
}

function assertSupportedCollection(collection: string): void {
  if (!SUPPORTED_COLLECTIONS.has(collection)) {
    throw new WikidataRequestError(
      `Wikidata source does not expose collection "${collection}" yet (supported: ${[...SUPPORTED_COLLECTIONS].join(", ")}).`,
      0,
      "wikidata.unknown_collection",
    );
  }
}

function assertValidQid(qid: string): void {
  if (!QID_PATTERN.test(qid)) {
    throw new WikidataRequestError(
      `Wikidata get requires a Q-ID like "Q42" (received "${qid}").`,
      0,
      "wikidata.invalid_qid",
    );
  }
}

function pickLocalized(map: Record<string, { value?: string }> | undefined, language: string): string | undefined {
  if (!map) return undefined;
  const direct = map[language]?.value;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const english = map.en?.value;
  if (typeof english === "string" && english.length > 0) return english;
  return undefined;
}

function pickAliases(
  aliases: Record<string, Array<{ value?: string }>> | undefined,
  language: string,
): string[] | undefined {
  if (!aliases) return undefined;
  const list = aliases[language] ?? aliases.en ?? [];
  const values = list.map((entry) => entry?.value).filter((value): value is string => typeof value === "string" && value.length > 0);
  return values.length > 0 ? values : undefined;
}

function extractStringClaim(claims: Record<string, RawClaim[]> | undefined, property: string): string | undefined {
  const list = claims?.[property];
  if (!list || list.length === 0) return undefined;
  for (const claim of list) {
    if (claim.rank === "deprecated") continue;
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function extractEntityIdClaims(claims: Record<string, RawClaim[]> | undefined, property: string): string[] | undefined {
  const list = claims?.[property];
  if (!list || list.length === 0) return undefined;
  const ids: string[] = [];
  for (const claim of list) {
    if (claim.rank === "deprecated") continue;
    const value = claim.mainsnak?.datavalue?.value;
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
      ids.push((value as { id: string }).id);
    }
  }
  return ids.length > 0 ? ids : undefined;
}

function extractWikipediaSitelinks(
  sitelinks: Record<string, { site?: string; title?: string; url?: string }> | undefined,
): Record<string, { title: string; url?: string }> | undefined {
  if (!sitelinks) return undefined;
  const result: Record<string, { title: string; url?: string }> = {};
  for (const [site, entry] of Object.entries(sitelinks)) {
    if (!site.endsWith("wiki")) continue;
    if (typeof entry?.title !== "string") continue;
    const key = site.replace(/wiki$/, "");
    result[key] = { title: entry.title, ...(typeof entry.url === "string" ? { url: entry.url } : {}) };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildExternalIds(claims: Record<string, RawClaim[]> | undefined): Record<string, string> | undefined {
  if (!claims) return undefined;
  const result: Record<string, string> = {};
  for (const entry of EXTERNAL_ID_PROPERTIES) {
    const value = extractStringClaim(claims, entry.property);
    if (value !== undefined) {
      result[entry.key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function projectEntity(raw: RawEntity, language: string): Record<string, unknown> {
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const label = pickLocalized(raw.labels, language);
  const description = pickLocalized(raw.descriptions, language);
  const aliases = pickAliases(raw.aliases, language);
  const instanceOf = extractEntityIdClaims(raw.claims, "P31");
  const externalIds = buildExternalIds(raw.claims);
  const wikipedia = extractWikipediaSitelinks(raw.sitelinks);

  return {
    id,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(aliases ? { aliases } : {}),
    ...(instanceOf ? { instance_of: instanceOf } : {}),
    ...(externalIds ? { external_ids: externalIds } : {}),
    ...(wikipedia ? { wikipedia } : {}),
  };
}

function projectSearchHit(hit: RawSearchHit): Record<string, unknown> {
  return {
    id: typeof hit.id === "string" ? hit.id : undefined,
    ...(typeof hit.label === "string" ? { label: hit.label } : {}),
    ...(typeof hit.description === "string" ? { description: hit.description } : {}),
    ...(Array.isArray(hit.aliases) && hit.aliases.length > 0 ? { aliases: [...hit.aliases] } : {}),
    ...(hit.match?.text ? { match: { type: hit.match.type, text: hit.match.text } } : {}),
  };
}

function cloneSchema(schema: WikidataSourceSchema): WikidataSourceSchema {
  return {
    source: schema.source,
    ...(schema.description ? { description: schema.description } : {}),
    collections: schema.collections.map((collection) => ({
      ...collection,
      fields: collection.fields.map((field) => ({ ...field })),
    })),
    external_id_properties: schema.external_id_properties.map((entry) => ({ ...entry })),
  };
}

async function wikidataError(response: Response, fallback: string): Promise<WikidataRequestError> {
  let message = fallback;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.error === "object" && body.error !== null) {
      const err = body.error as { info?: unknown; code?: unknown };
      if (typeof err.info === "string") message = err.info;
    } else if (typeof body.error === "string") {
      message = body.error;
    }
    details = body;
  } catch {
    if (response.status === 404) {
      message = `${fallback}: not found`;
    }
  }
  return new WikidataRequestError(message, response.status, `wikidata.${response.status}`, details);
}
