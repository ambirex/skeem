import { AdapterError } from "@skeems/types";

/**
 * Normalize a DOI per the shared external-ids contract: strip URL/`doi:`
 * prefixes and lowercase (DOIs are case-insensitive; lowercasing gives stable
 * join keys). Rejects values that don't look like a DOI.
 */
export function normalizeDoi(raw: string | number | boolean): string {
  const value = String(raw)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
  if (!/^10\.\d{4,9}\//.test(value)) {
    throw new AdapterError(`"${raw}" is not a valid DOI.`, { kind: "validation", field: "doi" });
  }
  return value;
}

/**
 * Encode a DOI for use in a URL path. DOI suffixes may contain `#`, `?`, `%`,
 * `<`, `>` (e.g. SICI DOIs), which would break a raw path — but the literal
 * slashes must survive, so each segment is encoded individually rather than the
 * whole string.
 */
export function encodeDoiPath(doi: string): string {
  return doi.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/** Strip the URL prefix from an ORCID value: keep the bare 0000-… form. */
export function normalizeOrcid(raw: string): string {
  return raw.trim().replace(/^https?:\/\/orcid\.org\//i, "");
}
