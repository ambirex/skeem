import { describe, expect, test } from "vitest";

import { extractLinkRelations } from "./relations.js";

function rel(type: string, url: string, ended = false) {
  return { type, ended, url: { resource: url } };
}

describe("extractLinkRelations", () => {
  test("normalizes wikidata, IMDb, and VIAF to bare ids", () => {
    const { externalIds } = extractLinkRelations([
      rel("wikidata", "https://www.wikidata.org/wiki/Q11649"),
      rel("IMDb", "https://www.imdb.com/name/nm1110321/"),
      rel("VIAF", "https://viaf.org/viaf/128483880/"),
    ]);
    expect(externalIds).toEqual({
      wikidata: ["Q11649"],
      imdb: ["nm1110321"],
      viaf: ["128483880"],
    });
  });

  test("keeps official homepage and wikipedia as URL-valued keys", () => {
    const { externalIds } = extractLinkRelations([
      rel("official homepage", "https://www.nirvana.com/"),
      rel("wikipedia", "https://en.wikipedia.org/wiki/Nirvana_(band)"),
    ]);
    expect(externalIds.official_website).toEqual(["https://www.nirvana.com/"]);
    expect(externalIds.wikipedia).toEqual(["https://en.wikipedia.org/wiki/Nirvana_(band)"]);
  });

  test("un-normalized relation types stay as raw URLs under links", () => {
    const { externalIds, links } = extractLinkRelations([
      rel("discogs", "https://www.discogs.com/artist/125246"),
      rel("allmusic", "https://www.allmusic.com/artist/mn0000357406"),
    ]);
    expect(externalIds).toEqual({});
    expect(links).toEqual({
      discogs: ["https://www.discogs.com/artist/125246"],
      allmusic: ["https://www.allmusic.com/artist/mn0000357406"],
    });
  });

  test("dedupes duplicate values (e.g. current + ended relations)", () => {
    const { externalIds } = extractLinkRelations([
      rel("wikidata", "https://www.wikidata.org/wiki/Q11649"),
      rel("wikidata", "https://www.wikidata.org/wiki/Q11649", true),
    ]);
    expect(externalIds.wikidata).toEqual(["Q11649"]);
  });

  test("isnis ride along with spaces stripped", () => {
    const { externalIds } = extractLinkRelations([], ["0000 0001 0786 9412"]);
    expect(externalIds.isni).toEqual(["0000000107869412"]);
  });
});
