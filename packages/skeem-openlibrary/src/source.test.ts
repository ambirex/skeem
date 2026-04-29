import { describe, expect, test } from "vitest";

import { createOpenLibrarySource } from "./source.js";
import { OpenLibraryRequestError } from "./types.js";

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

describe("openlibrary source", () => {
  test("describe returns the curated works/editions schema", async () => {
    const source = createOpenLibrarySource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });

    const schema = source.describe();
    expect(schema.source).toBe("openlibrary");
    const collections = schema.collections.map((collection) => collection.name);
    expect(collections).toEqual(["works", "editions"]);
    const works = schema.collections.find((c) => c.name === "works");
    expect(works?.primaryKey).toBe("id");
    expect(works?.searchable).toBe(true);
    expect(works?.fields.map((f) => f.name)).toContain("first_publish_year");
    const editions = schema.collections.find((c) => c.name === "editions");
    expect(editions?.searchable).toBe(false);
    expect(editions?.fields.map((f) => f.name)).toContain("isbn_13");
  });

  test("connect rejects an unparseable base URL", async () => {
    const source = createOpenLibrarySource();
    await expect(source.connect({ base_url: "not a url" })).rejects.toBeInstanceOf(OpenLibraryRequestError);
  });

  test("get on works projects key into OLID and parses first_publish_year from a date string", async () => {
    const { stub, calls } = makeFetchStub(() => ({
      key: "/works/OL45804W",
      title: "Fantastic Mr Fox",
      authors: [{ author: { key: "/authors/OL34184A" }, type: { key: "/type/author_role" } }],
      first_publish_date: "October 1970",
      subjects: ["Children's stories", "Foxes"],
      ignored_field: "should not surface",
    }));

    const source = createOpenLibrarySource();
    await source.connect({ fetch: stub });
    const record = await source.get("works", "OL45804W");

    expect(record).toMatchObject({
      id: "OL45804W",
      title: "Fantastic Mr Fox",
      first_publish_year: 1970,
      subjects: ["Children's stories", "Foxes"],
    });
    expect(record.authors).toEqual([{ id: "OL34184A" }]);
    expect(record).not.toHaveProperty("ignored_field");
    expect(new URL(calls[0]!.url).pathname).toBe("/works/OL45804W.json");
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toMatch(/skeem-openlibrary/);
  });

  test("get on editions projects fields and surfaces work_id when linked", async () => {
    const { stub, calls } = makeFetchStub(() => ({
      key: "/books/OL7353617M",
      title: "Fantastic Mr Fox",
      isbn_10: ["0140328726"],
      isbn_13: ["9780140328721"],
      publish_date: "October 1, 1988",
      number_of_pages: 96,
      publishers: ["Puffin"],
      works: [{ key: "/works/OL45804W" }],
    }));

    const source = createOpenLibrarySource();
    await source.connect({ fetch: stub });
    const record = await source.get("editions", "OL7353617M");

    expect(record).toMatchObject({
      id: "OL7353617M",
      title: "Fantastic Mr Fox",
      isbn_13: ["9780140328721"],
      number_of_pages: 96,
      work_id: "OL45804W",
    });
    expect(new URL(calls[0]!.url).pathname).toBe("/books/OL7353617M.json");
  });

  test("get surfaces 404s with a clean error envelope", async () => {
    const { stub } = makeFetchStub(() => ({
      status: 404,
      body: { error: "notfound" },
    }));

    const source = createOpenLibrarySource();
    await source.connect({ fetch: stub });

    await expect(source.get("works", "OL_DOES_NOT_EXIST_W")).rejects.toMatchObject({
      name: "OpenLibraryRequestError",
      status: 404,
      code: "openlibrary.404",
    });
  });

  test("find requires a query filter", async () => {
    const source = createOpenLibrarySource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });
    await expect(source.find("works", {})).rejects.toMatchObject({
      code: "openlibrary.missing_query",
    });
  });

  test("find returns search results scoped to limit and filters non-works", async () => {
    const { stub, calls } = makeFetchStub((url) => {
      expect(url.pathname).toBe("/search.json");
      expect(url.searchParams.get("q")).toBe("inception");
      return {
        numFound: 4,
        start: 0,
        docs: [
          { key: "/works/OL1W", title: "Inception", first_publish_year: 2010, author_name: ["A"], author_key: ["OL1A"] },
          { key: "/authors/OL999A", title: "Should be filtered" },
          { key: "/works/OL2W", title: "Inception II", first_publish_year: 2011, author_name: ["B"] },
          { key: "/works/OL3W", title: "Inception III" },
        ],
      };
    });

    const source = createOpenLibrarySource();
    await source.connect({ fetch: stub });
    const records = await source.find("works", { query: "inception" }, { limit: 2 });

    expect(records.map((row) => row.id)).toEqual(["OL1W", "OL2W"]);
    expect(records[0]?.authors).toEqual([{ id: "OL1A", name: "A" }]);
    expect(calls).toHaveLength(1);
  });

  test("find paginates when more results are needed", async () => {
    const { stub, calls } = makeFetchStub((url) => {
      const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const startId = (page - 1) * 50;
      return {
        numFound: 200,
        start: startId,
        docs: Array.from({ length: 50 }).map((_, index) => ({
          key: `/works/OL${startId + index}W`,
          title: `Match ${startId + index}`,
        })),
      };
    });

    const source = createOpenLibrarySource();
    await source.connect({ fetch: stub });
    const records = await source.find("works", { query: "matrix" }, { limit: 60 });
    expect(records).toHaveLength(60);
    expect(calls).toHaveLength(2);
    // First and second-page boundaries
    expect(records[0]?.id).toBe("OL0W");
    expect(records[59]?.id).toBe("OL59W");
  });

  test("find honors offset by jumping to the right page", async () => {
    const { stub } = makeFetchStub((url) => {
      const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
      const startId = (page - 1) * limit;
      return {
        numFound: 200,
        start: startId,
        docs: Array.from({ length: limit }).map((_, index) => ({
          key: `/works/OL${startId + index}W`,
        })),
      };
    });

    const source = createOpenLibrarySource();
    await source.connect({ fetch: stub });
    const records = await source.find("works", { query: "x" }, { limit: 3, offset: 7 });
    expect(records.map((row) => row.id)).toEqual(["OL7W", "OL8W", "OL9W"]);
  });

  test("rejects find on editions with a clear error", async () => {
    const source = createOpenLibrarySource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });
    await expect(source.find("editions", { query: "x" })).rejects.toMatchObject({
      code: "openlibrary.find_unsupported_collection",
    });
  });

  test("rejects unsupported collections", async () => {
    const source = createOpenLibrarySource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });
    await expect(source.get("authors", "OL1A")).rejects.toMatchObject({
      code: "openlibrary.unknown_collection",
    });
    await expect(source.find("authors", { query: "x" })).rejects.toMatchObject({
      code: "openlibrary.unknown_collection",
    });
  });

  test("respects an explicit base_url override", async () => {
    const { stub, calls } = makeFetchStub(() => ({ key: "/works/OL1W", title: "X" }));
    const source = createOpenLibrarySource();
    await source.connect({ base_url: "https://example.test/ol/", fetch: stub });
    await source.get("works", "OL1W");
    expect(new URL(calls[0]!.url).origin).toBe("https://example.test");
    expect(new URL(calls[0]!.url).pathname).toBe("/ol/works/OL1W.json");
  });
});
