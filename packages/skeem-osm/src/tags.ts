/**
 * Extract the shared externalIds vocabulary from an OSM element's tags.
 *
 * Only the **bare** `wikidata` tag identifies the element itself; prefixed
 * variants (`brand:wikidata`, `operator:wikidata`, `subject:wikidata`, …)
 * identify the brand/operator/subject and must NOT feed `externalIds.wikidata`
 * — conflating them would make every franchise location "be" its brand. They
 * remain visible in the record's `tags`.
 */
export function externalIdsFromTags(tags: Record<string, string> | undefined): Record<string, string[]> {
  const externalIds: Record<string, string[]> = {};
  if (!tags) return externalIds;

  if (tags.wikidata) {
    // OSM multi-value convention: semicolon-separated.
    const values = tags.wikidata
      .split(";")
      .map((value) => value.trim().toUpperCase())
      .filter((value) => /^Q\d+$/.test(value));
    if (values.length > 0) {
      externalIds.wikidata = Array.from(new Set(values));
    }
  }

  if (tags.wikipedia) {
    const url = wikipediaTagToUrl(tags.wikipedia);
    if (url) {
      externalIds.wikipedia = [url];
    }
  }

  const website = tags.website ?? tags["contact:website"];
  if (website) {
    externalIds.official_website = [website];
  }

  return externalIds;
}

/** OSM wikipedia tags are "lang:Article Title" — convert to a URL. */
function wikipediaTagToUrl(tag: string): string | undefined {
  const separator = tag.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const lang = tag.slice(0, separator);
  const title = tag.slice(separator + 1).trim();
  if (!/^[a-z][a-z-]*$/i.test(lang) || title.length === 0) {
    return undefined;
  }
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}
