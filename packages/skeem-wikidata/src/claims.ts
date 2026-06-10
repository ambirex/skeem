import type { WikibaseStatement } from "./types.js";

/**
 * Curated map of Wikidata external-id properties to the conventional key
 * vocabulary shared by every skeem read adapter (docs/reference/external-ids.md).
 * Every entry was verified against the live property labels on 2026-06-10.
 * Unmapped external-id properties keep their raw P-id as the key.
 */
export const EXTERNAL_ID_PROPERTIES: Record<string, string> = {
  P345: "imdb",
  P434: "musicbrainz_artist",
  P435: "musicbrainz_work",
  P436: "musicbrainz_release_group",
  P966: "musicbrainz_label",
  P4404: "musicbrainz_recording",
  P5813: "musicbrainz_release",
  P648: "openlibrary",
  P212: "isbn_13",
  P957: "isbn_10",
  P243: "oclc",
  P244: "lc_naf",
  P1144: "lccn",
  P214: "viaf",
  P213: "isni",
  P496: "orcid",
  P356: "doi",
  P698: "pubmed",
  P932: "pmc",
  P236: "issn",
  P402: "osm_relation",
  P11693: "osm_node",
  P10689: "osm_way",
  P4947: "tmdb_movie",
  P4983: "tmdb_tv",
  P4985: "tmdb_person",
  P2963: "goodreads_author",
  P2969: "goodreads_book",
};

/** Reverse lookup: conventional key -> P-id, for find-by-external-id. */
export const EXTERNAL_ID_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(EXTERNAL_ID_PROPERTIES).map(([pid, key]) => [key, pid]),
);

export interface PartitionedClaims {
  claims: Record<string, unknown[]>;
  externalIds: Record<string, string[]>;
}

/**
 * Split Wikibase claims into ordinary statements and external identifiers.
 * Statements whose mainsnak datatype is "external-id" land in `externalIds`
 * (keyed by the conventional name when curated, the raw P-id otherwise);
 * P856 ("official website", datatype url) is special-cased to
 * `official_website`. Everything else stays in `claims`, simplified the same
 * way as before. externalIds values are always deduped arrays of strings —
 * novalue/somevalue snaks are skipped there (they stay as null in `claims`).
 */
export function partitionClaims(
  claims: Record<string, WikibaseStatement[]> | undefined,
): PartitionedClaims {
  const ordinary: Record<string, unknown[]> = {};
  const externalIds: Record<string, string[]> = {};
  if (!claims) {
    return { claims: ordinary, externalIds };
  }

  for (const [propertyId, statements] of Object.entries(claims)) {
    const datatype = statements[0]?.mainsnak?.datatype;
    const externalKey = datatype === "external-id"
      ? EXTERNAL_ID_PROPERTIES[propertyId] ?? propertyId
      : propertyId === "P856" && datatype === "url"
        ? "official_website"
        : undefined;

    if (externalKey !== undefined) {
      const values = statements
        .map((statement) => simplifyStatement(statement))
        .filter((value): value is string | number => value !== undefined && value !== null)
        .map((value) => String(value));
      const deduped = Array.from(new Set(values));
      if (deduped.length > 0) {
        externalIds[externalKey] = [...(externalIds[externalKey] ?? []), ...deduped];
      }
      continue;
    }

    const values = statements
      .map((statement) => simplifyStatement(statement))
      .filter((value) => value !== undefined);
    if (values.length > 0) {
      ordinary[propertyId] = values;
    }
  }

  return { claims: ordinary, externalIds };
}

/**
 * Flatten Wikibase claims into `{ propertyId: [value, ...] }`, simplifying each
 * datavalue to a plain JS value. Entity references collapse to their id (e.g.
 * "Q5"), times to their ISO-ish string, quantities to their amount, etc. This is
 * lossy on purpose — the goal is a readable payload an agent can act on, not a
 * faithful RDF reproduction.
 */
export function simplifyClaims(
  claims: Record<string, WikibaseStatement[]> | undefined,
): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  if (!claims) return result;

  for (const [propertyId, statements] of Object.entries(claims)) {
    const values = statements
      .map((statement) => simplifyStatement(statement))
      .filter((value) => value !== undefined);
    if (values.length > 0) {
      result[propertyId] = values;
    }
  }
  return result;
}

function simplifyStatement(statement: WikibaseStatement): unknown {
  const snak = statement.mainsnak;
  if (!snak) return undefined;
  // "novalue" = asserted to have no value; "somevalue" = exists but unknown.
  if (snak.snaktype !== "value" || !snak.datavalue) {
    return null;
  }
  return simplifyDataValue(snak.datavalue);
}

function simplifyDataValue(datavalue: { value: unknown; type: string }): unknown {
  const value = datavalue.value as Record<string, unknown>;
  switch (datavalue.type) {
    case "wikibase-entityid":
      return value.id; // e.g. "Q5"
    case "time":
      return value.time; // e.g. "+1952-03-11T00:00:00Z"
    case "monolingualtext":
      return value.text;
    case "quantity":
      return value.amount; // e.g. "+1.96"
    case "globecoordinate":
      return { latitude: value.latitude, longitude: value.longitude };
    case "string":
      return datavalue.value;
    default:
      return datavalue.value;
  }
}
