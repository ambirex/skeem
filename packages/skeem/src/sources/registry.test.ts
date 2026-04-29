import { describe, expect, test } from "vitest";

import {
  instantiateSource,
  isSupportedSourceType,
  listSupportedSourceTypes,
  summarizeConfiguredSources,
} from "./registry.js";

describe("source registry", () => {
  test("lists tmdb, openlibrary, and wikidata as supported source types", () => {
    expect(listSupportedSourceTypes()).toEqual(expect.arrayContaining(["tmdb", "openlibrary", "wikidata"]));
    expect(isSupportedSourceType("tmdb")).toBe(true);
    expect(isSupportedSourceType("openlibrary")).toBe(true);
    expect(isSupportedSourceType("wikidata")).toBe(true);
    expect(isSupportedSourceType("imdb")).toBe(false);
  });

  test("instantiateSource resolves an openlibrary source via the configured factory", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({}))) as typeof fetch;
    const source = await instantiateSource("books", {
      books: {
        type: "openlibrary",
        fetch: fakeFetch,
      },
    });
    expect(source.kind).toBe("read_source");
    expect(source.name).toBe("openlibrary");
    expect(source.describe().collections.find((c) => c.name === "works")).toBeTruthy();
  });

  test("instantiateSource resolves a wikidata source via the configured factory", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({}))) as typeof fetch;
    const source = await instantiateSource("entities", {
      entities: {
        type: "wikidata",
        fetch: fakeFetch,
      },
    });
    expect(source.kind).toBe("read_source");
    expect(source.name).toBe("wikidata");
    expect(source.describe().collections.find((c) => c.name === "entities")).toBeTruthy();
  });

  test("summarizes configured sources alphabetically and flags unsupported types", () => {
    const summary = summarizeConfiguredSources({
      movies: { type: "tmdb", api_key: "k" },
      books: { type: "openlibrary" },
      notes: { type: "imaginary-source" },
    });
    expect(summary.map((entry) => entry.name)).toEqual(["books", "movies", "notes"]);
    expect(summary.find((entry) => entry.name === "movies")?.supported).toBe(true);
    expect(summary.find((entry) => entry.name === "books")?.supported).toBe(true);
    expect(summary.find((entry) => entry.name === "notes")?.supported).toBe(false);
  });

  test("instantiateSource throws when the source name is unknown", async () => {
    await expect(instantiateSource("missing", {})).rejects.toMatchObject({
      message: /not configured/i,
    });
  });

  test("instantiateSource throws for unsupported types", async () => {
    await expect(instantiateSource("notes", {
      notes: { type: "imaginary-source" },
    })).rejects.toMatchObject({
      message: /unsupported type/i,
    });
  });

  test("instantiateSource resolves a tmdb source via the configured factory", async () => {
    let connected = false;
    const fakeFetch = (async () => new Response(JSON.stringify({}))) as typeof fetch;
    const source = await instantiateSource("movies", {
      movies: {
        type: "tmdb",
        api_key: "k1",
        fetch: fakeFetch,
      },
    });
    connected = source.kind === "read_source";
    expect(connected).toBe(true);
    expect(source.name).toBe("tmdb");
    expect(source.describe().collections.find((c) => c.name === "movies")).toBeTruthy();
  });
});
