import { afterEach, describe, expect, test } from "vitest";

import { createTmdbAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const V4_TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
const V3_KEY = "0123456789abcdef0123456789abcdef";

const matrix = {
  id: 603,
  title: "The Matrix",
  release_date: "1999-03-30",
  overview: "A hacker learns the truth.",
  vote_average: 8.2,
  external_ids: { imdb_id: "tt0133093", wikidata_id: "Q83495", facebook_id: null, twitter_id: null },
};

describe("createTmdbAdapter", () => {
  test("is a named, read-only surface with three collections", async () => {
    const adapter = createTmdbAdapter();
    expect(adapter.name).toBe("tmdb");
    await adapter.connect({ url: "https://api.themoviedb.org/3", token: V4_TOKEN });
    const schema = await adapter.introspect();
    expect([...schema.collections.keys()].sort()).toEqual(["movies", "people", "tv"]);
    expect(schema.collections.get("movies")?.fields.get("id")?.type).toBe("integer");
    await expect(adapter.create("movies", {})).rejects.toThrow(/read-only/i);
  });

  test("a v4 token goes in the Bearer header; a v3 key in api_key", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(url), auth: headers.get("Authorization") });
      return json(matrix);
    }) as unknown as typeof fetch;

    const v4 = createTmdbAdapter();
    await v4.connect({ url: "https://api.themoviedb.org/3", token: V4_TOKEN });
    await v4.get("movies", 603);
    expect(seen[0]!.auth).toBe(`Bearer ${V4_TOKEN}`);
    expect(seen[0]!.url).not.toContain("api_key=");

    const v3 = createTmdbAdapter();
    await v3.connect({ url: "https://api.themoviedb.org/3", token: V3_KEY });
    await v3.get("movies", 603);
    expect(seen[1]!.auth).toBeNull();
    expect(seen[1]!.url).toContain(`api_key=${V3_KEY}`);
  });

  test("missing token fails with a clear auth error before any request", async () => {
    globalThis.fetch = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const adapter = createTmdbAdapter();
    await adapter.connect({ url: "https://api.themoviedb.org/3" });
    await expect(adapter.get("movies", 603)).rejects.toThrow(/requires an API token/i);
  });

  test("get appends external_ids and maps them to the shared vocabulary", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json(matrix);
    }) as unknown as typeof fetch;

    const adapter = createTmdbAdapter();
    await adapter.connect({ url: "https://api.themoviedb.org/3", token: V4_TOKEN });
    const record = await adapter.get("movies", 603);

    expect(calls[0]).toContain("/movie/603");
    expect(calls[0]).toContain("append_to_response=external_ids");
    expect(record.title).toBe("The Matrix");
    expect(record.externalIds).toEqual({
      imdb: ["tt0133093"],
      wikidata: ["Q83495"],
    });
  });

  test("find reverse-resolves an IMDb id via /find and picks the collection bucket", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ movie_results: [matrix], person_results: [] });
    }) as unknown as typeof fetch;

    const adapter = createTmdbAdapter();
    await adapter.connect({ url: "https://api.themoviedb.org/3", token: V4_TOKEN });
    const rows = await adapter.find("movies", { imdb: "TT0133093" });

    const url = new URL(calls[0]!);
    expect(url.pathname).toContain("/find/tt0133093"); // lowercased
    expect(url.searchParams.get("external_source")).toBe("imdb_id");
    expect(rows[0]).toMatchObject({ id: 603, title: "The Matrix" });
  });

  test("find searches by title; page-based limits enforced", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ results: [matrix] });
    }) as unknown as typeof fetch;

    const adapter = createTmdbAdapter();
    await adapter.connect({ url: "https://api.themoviedb.org/3", token: V4_TOKEN });
    const rows = await adapter.find("movies", { title: "The Matrix" }, { limit: 5 });
    expect(new URL(calls[0]!).pathname).toContain("/search/movie");
    expect(rows).toHaveLength(1);

    await expect(adapter.find("movies", { title: "x" }, { offset: 20 })).rejects.toThrow(/--offset/);
    await expect(adapter.find("movies", { title: "x" }, { limit: 21 })).rejects.toThrow(/up to 20/);
    await expect(adapter.find("movies", { title: "x" }, { sort: "title" })).rejects.toThrow(/--sort/);
  });

  test("TMDB status codes map: 34 -> not_found, 7 -> auth with hint", async () => {
    globalThis.fetch = (async () =>
      json({ status_code: 34, status_message: "The resource you requested could not be found.", success: false }, 404)
    ) as unknown as typeof fetch;
    const adapter = createTmdbAdapter();
    await adapter.connect({ url: "https://api.themoviedb.org/3", token: V4_TOKEN });
    await expect(adapter.get("movies", 999999999)).rejects.toThrow(/could not be found/i);

    globalThis.fetch = (async () =>
      json({ status_code: 7, status_message: "Invalid API key", success: false }, 401)
    ) as unknown as typeof fetch;
    const second = createTmdbAdapter();
    await second.connect({ url: "https://api.themoviedb.org/3", token: V4_TOKEN });
    await expect(second.get("movies", 603)).rejects.toThrow(/v4 Read Access Token or a v3 API key/i);
  });
});
