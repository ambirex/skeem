import { describe, expect, test } from "vitest";

import { createTmdbSource } from "./source.js";
import { TmdbRequestError } from "./types.js";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function makeFetchStub(handler: (url: URL, init?: RequestInit) => unknown) {
  const calls: RecordedCall[] = [];
  const stub: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url: urlString, ...(init ? { init } : {}) });
    const url = new URL(urlString);
    const result = await Promise.resolve(handler(url, init));
    if (result instanceof Response) {
      return result;
    }
    if (typeof result === "object" && result !== null && "status" in result) {
      const { status, body } = result as { status: number; body?: unknown };
      return new Response(body === undefined ? "" : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { stub, calls };
}

describe("tmdb source", () => {
  test("describe returns the curated movies schema", async () => {
    const source = createTmdbSource();
    await source.connect({ api_key: "test", fetch: makeFetchStub(() => ({})).stub });

    const schema = source.describe();
    expect(schema.source).toBe("tmdb");
    const movies = schema.collections.find((collection) => collection.name === "movies");
    expect(movies?.primaryKey).toBe("id");
    expect(movies?.searchable).toBe(true);
    expect(movies?.fields.map((field) => field.name)).toContain("title");
    expect(movies?.fields.map((field) => field.name)).toContain("release_date");
  });

  test("connect rejects missing credentials", async () => {
    const source = createTmdbSource();
    await expect(source.connect({})).rejects.toBeInstanceOf(TmdbRequestError);
  });

  test("get fetches a movie by id and projects curated fields", async () => {
    const { stub, calls } = makeFetchStub(() => ({
      id: 603,
      title: "The Matrix",
      original_title: "The Matrix",
      release_date: "1999-03-30",
      overview: "A computer hacker learns the truth.",
      popularity: 75.1,
      vote_average: 8.2,
      vote_count: 22000,
      original_language: "en",
      ignored_extra_field: "should not surface",
    }));

    const source = createTmdbSource();
    await source.connect({ api_key: "k1", fetch: stub });
    const record = await source.get("movies", 603);

    expect(record.title).toBe("The Matrix");
    expect(record.id).toBe(603);
    expect(record).not.toHaveProperty("ignored_extra_field");
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/3/movie/603");
    expect(url.searchParams.get("api_key")).toBe("k1");
  });

  test("get surfaces TMDB error envelopes", async () => {
    const { stub } = makeFetchStub(() => ({
      status: 404,
      body: { status_code: 34, status_message: "The resource you requested could not be found." },
    }));

    const source = createTmdbSource();
    await source.connect({ api_key: "k1", fetch: stub });

    await expect(source.get("movies", 9999999)).rejects.toMatchObject({
      name: "TmdbRequestError",
      status: 404,
      code: "tmdb.34",
      message: /could not be found/i,
    });
  });

  test("find requires a query filter", async () => {
    const source = createTmdbSource();
    await source.connect({ api_key: "k1", fetch: makeFetchStub(() => ({})).stub });
    await expect(source.find("movies", {})).rejects.toMatchObject({
      code: "tmdb.missing_query",
    });
  });

  test("find returns search results scoped to limit", async () => {
    const { stub, calls } = makeFetchStub((url) => {
      expect(url.pathname).toBe("/3/search/movie");
      expect(url.searchParams.get("query")).toBe("Inception");
      return {
        page: 1,
        results: Array.from({ length: 5 }).map((_, index) => ({
          id: 1000 + index,
          title: `Match ${index}`,
        })),
        total_pages: 1,
        total_results: 5,
      };
    });

    const source = createTmdbSource();
    await source.connect({ api_key: "k1", fetch: stub });
    const records = await source.find("movies", { query: "Inception" }, { limit: 3 });
    expect(records.map((row) => row.id)).toEqual([1000, 1001, 1002]);
    expect(calls).toHaveLength(1);
  });

  test("find paginates across pages when more results are needed", async () => {
    const { stub, calls } = makeFetchStub((url) => {
      const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const startId = 2000 + (page - 1) * 20;
      return {
        page,
        results: Array.from({ length: 20 }).map((_, index) => ({ id: startId + index, title: `Row ${startId + index}` })),
        total_pages: 3,
        total_results: 60,
      };
    });

    const source = createTmdbSource();
    await source.connect({ api_key: "k1", fetch: stub });
    const records = await source.find("movies", { query: "matrix" }, { limit: 25 });
    expect(records).toHaveLength(25);
    expect(calls).toHaveLength(2);
  });

  test("find honors offset by jumping to the right page", async () => {
    const { stub } = makeFetchStub((url) => {
      const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const startId = 4000 + (page - 1) * 20;
      return {
        page,
        results: Array.from({ length: 20 }).map((_, index) => ({ id: startId + index })),
        total_pages: 5,
      };
    });

    const source = createTmdbSource();
    await source.connect({ api_key: "k1", fetch: stub });
    const records = await source.find("movies", { query: "x" }, { limit: 2, offset: 22 });
    expect(records.map((row) => row.id)).toEqual([4022, 4023]);
  });

  test("rejects unsupported collections", async () => {
    const source = createTmdbSource();
    await source.connect({ api_key: "k1", fetch: makeFetchStub(() => ({})).stub });
    await expect(source.get("people", 1)).rejects.toMatchObject({ code: "tmdb.unknown_collection" });
    await expect(source.find("people", { query: "x" })).rejects.toMatchObject({ code: "tmdb.unknown_collection" });
  });

  test("uses bearer auth when read_token is configured", async () => {
    const { stub, calls } = makeFetchStub(() => ({ id: 1, title: "Test" }));
    const source = createTmdbSource();
    await source.connect({ read_token: "v4-read-token", fetch: stub });
    await source.get("movies", 1);

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer v4-read-token");
    expect(new URL(calls[0]!.url).searchParams.get("api_key")).toBeNull();
  });
});
