import { describe, expect, test } from "vitest";

import { defaultAdapterUrl, knownAdapters } from "./adapters.js";

describe("defaultAdapterUrl", () => {
  test("returns canonical URLs for the read-tier reference adapters", () => {
    expect(defaultAdapterUrl("wikidata")).toBe("https://www.wikidata.org");
    expect(defaultAdapterUrl("musicbrainz")).toBe("https://musicbrainz.org");
    expect(defaultAdapterUrl("osm")).toBe("https://api.openstreetmap.org");
    expect(defaultAdapterUrl("openlibrary")).toBe("https://openlibrary.org");
    expect(defaultAdapterUrl("crossref")).toBe("https://api.crossref.org");
    expect(defaultAdapterUrl("tmdb")).toBe("https://api.themoviedb.org/3");
  });

  test("returns undefined for writable backends (deployment-specific URLs)", () => {
    expect(defaultAdapterUrl("directus")).toBeUndefined();
    expect(defaultAdapterUrl("pocketbase")).toBeUndefined();
    expect(defaultAdapterUrl("nocodb")).toBeUndefined();
    expect(defaultAdapterUrl("strapi")).toBeUndefined();
  });

  test("returns undefined for an unknown adapter", () => {
    expect(defaultAdapterUrl("nope")).toBeUndefined();
  });

  test("every reference adapter with a default is a known adapter", () => {
    const known = new Set(knownAdapters());
    for (const name of ["wikidata", "musicbrainz", "osm", "openlibrary", "crossref", "tmdb"]) {
      expect(known.has(name)).toBe(true);
    }
  });
});
