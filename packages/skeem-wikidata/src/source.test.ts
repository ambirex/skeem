import { describe, expect, test } from "vitest";

import { createWikidataSource } from "./source.js";
import { WikidataRequestError } from "./types.js";

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
    if (result instanceof Response) return result;
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

function entityResponse(qid: string, raw: Record<string, unknown>) {
  return { entities: { [qid]: { id: qid, ...raw } } };
}

describe("wikidata source", () => {
  test("describe returns the curated entities schema and exposed external_id_properties", async () => {
    const source = createWikidataSource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });

    const schema = source.describe();
    expect(schema.source).toBe("wikidata");
    const collections = schema.collections.map((c) => c.name);
    expect(collections).toEqual(["entities"]);
    const entities = schema.collections.find((c) => c.name === "entities");
    expect(entities?.primaryKey).toBe("id");
    expect(entities?.searchable).toBe(true);
    expect(entities?.fields.map((f) => f.name)).toContain("external_ids");

    const propertyKeys = schema.external_id_properties.map((entry) => entry.key);
    expect(propertyKeys).toContain("tmdb_movie_id");
    expect(propertyKeys).toContain("openlibrary_work_id");
    expect(propertyKeys).toContain("musicbrainz_artist_id");
    expect(schema.external_id_properties.find((entry) => entry.key === "tmdb_movie_id")?.property).toBe("P4947");
  });

  test("connect rejects unparseable base URLs", async () => {
    const source = createWikidataSource();
    await expect(source.connect({ base_url: "not a url" })).rejects.toBeInstanceOf(WikidataRequestError);
  });

  test("get rejects non-Q-ID input", async () => {
    const source = createWikidataSource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });
    await expect(source.get("entities", "P648")).rejects.toMatchObject({ code: "wikidata.invalid_qid" });
    await expect(source.get("entities", "douglas adams")).rejects.toMatchObject({ code: "wikidata.invalid_qid" });
  });

  test("get on entities projects label, description, instance_of, external_ids, and wikipedia", async () => {
    const { stub, calls } = makeFetchStub((url) => {
      expect(url.pathname).toBe("/wiki/Special:EntityData/Q42.json");
      return entityResponse("Q42", {
        labels: {
          en: { language: "en", value: "Douglas Adams" },
          de: { language: "de", value: "Douglas Adams (Schriftsteller)" },
        },
        descriptions: { en: { language: "en", value: "English author and humourist (1952–2001)" } },
        aliases: { en: [{ language: "en", value: "Douglas Noël Adams" }] },
        claims: {
          P31: [
            {
              rank: "normal",
              mainsnak: { snaktype: "value", datatype: "wikibase-item", datavalue: { type: "wikibase-entityid", value: { id: "Q5", "entity-type": "item" } } },
            },
          ],
          P648: [
            { rank: "normal", mainsnak: { snaktype: "value", datatype: "external-id", datavalue: { type: "string", value: "OL272947A" } } },
          ],
          P345: [
            { rank: "normal", mainsnak: { snaktype: "value", datatype: "external-id", datavalue: { type: "string", value: "nm0010930" } } },
          ],
          P214: [
            { rank: "normal", mainsnak: { snaktype: "value", datatype: "external-id", datavalue: { type: "string", value: "113230702" } } },
          ],
        },
        sitelinks: {
          enwiki: { site: "enwiki", title: "Douglas Adams", url: "https://en.wikipedia.org/wiki/Douglas_Adams" },
          dewiki: { site: "dewiki", title: "Douglas Adams" },
          commonswiki: { site: "commonswiki", title: "Category:Douglas Adams" },
        },
      });
    });

    const source = createWikidataSource();
    await source.connect({ fetch: stub });
    const record = await source.get("entities", "Q42");

    expect(record).toMatchObject({
      id: "Q42",
      label: "Douglas Adams",
      description: expect.stringMatching(/English author/i),
      aliases: ["Douglas Noël Adams"],
      instance_of: ["Q5"],
      external_ids: {
        openlibrary_work_id: "OL272947A",
        imdb_id: "nm0010930",
        viaf_id: "113230702",
      },
    });
    expect((record.wikipedia as Record<string, unknown>).en).toMatchObject({
      title: "Douglas Adams",
      url: "https://en.wikipedia.org/wiki/Douglas_Adams",
    });
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toMatch(/skeem-wikidata/);
  });

  test("get falls back to English when the configured language is missing", async () => {
    const { stub } = makeFetchStub(() => entityResponse("Q42", {
      labels: { en: { language: "en", value: "Douglas Adams" } },
    }));
    const source = createWikidataSource();
    await source.connect({ fetch: stub, language: "fr" });
    const record = await source.get("entities", "Q42");
    expect(record.label).toBe("Douglas Adams");
  });

  test("get errors when the entity is missing from the response", async () => {
    const { stub } = makeFetchStub(() => ({ entities: {} }));
    const source = createWikidataSource();
    await source.connect({ fetch: stub });
    await expect(source.get("entities", "Q9999999")).rejects.toMatchObject({
      code: "wikidata.entity_missing",
    });
  });

  test("get surfaces 404 errors with a clean envelope", async () => {
    const { stub } = makeFetchStub(() => ({ status: 404, body: { error: { info: "no such entity" } } }));
    const source = createWikidataSource();
    await source.connect({ fetch: stub });
    await expect(source.get("entities", "Q9999999999")).rejects.toMatchObject({
      name: "WikidataRequestError",
      status: 404,
      code: "wikidata.404",
    });
  });

  test("find requires a query filter", async () => {
    const source = createWikidataSource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });
    await expect(source.find("entities", {})).rejects.toMatchObject({
      code: "wikidata.missing_query",
    });
  });

  test("find returns wbsearchentities results scoped to limit", async () => {
    const { stub, calls } = makeFetchStub((url) => {
      expect(url.pathname).toBe("/w/api.php");
      expect(url.searchParams.get("action")).toBe("wbsearchentities");
      expect(url.searchParams.get("search")).toBe("Douglas Adams");
      expect(url.searchParams.get("language")).toBe("en");
      return {
        success: 1,
        search: [
          { id: "Q42", label: "Douglas Adams", description: "English author", match: { type: "label", text: "Douglas Adams" } },
          { id: "Q113930", label: "Douglas Adams", description: "American politician" },
          { id: "Q41157", label: "John Douglas Adams", description: "American architect" },
        ],
      };
    });

    const source = createWikidataSource();
    await source.connect({ fetch: stub });
    const records = await source.find("entities", { query: "Douglas Adams" }, { limit: 2 });

    expect(records.map((row) => row.id)).toEqual(["Q42", "Q113930"]);
    expect(records[0]?.match).toEqual({ type: "label", text: "Douglas Adams" });
    expect(calls).toHaveLength(1);
  });

  test("find paginates via the search-continue cursor", async () => {
    let callCount = 0;
    const { stub } = makeFetchStub((url) => {
      callCount += 1;
      const continueValue = Number.parseInt(url.searchParams.get("continue") ?? "0", 10);
      if (continueValue === 0) {
        return {
          success: 1,
          search: Array.from({ length: 50 }).map((_, index) => ({ id: `Q${1000 + index}` })),
          "search-continue": 50,
        };
      }
      return {
        success: 1,
        search: Array.from({ length: 50 }).map((_, index) => ({ id: `Q${1050 + index}` })),
      };
    });

    const source = createWikidataSource();
    await source.connect({ fetch: stub });
    const records = await source.find("entities", { query: "x" }, { limit: 50 });
    expect(records).toHaveLength(50);

    const more = await source.find("entities", { query: "x" }, { limit: 60 });
    expect(more).toHaveLength(60);
    expect(more[50]?.id).toBe("Q1050");
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test("find honors offset by passing it as the initial continue cursor", async () => {
    const { stub, calls } = makeFetchStub((url) => {
      const cursor = Number.parseInt(url.searchParams.get("continue") ?? "0", 10);
      return {
        success: 1,
        search: [
          { id: `Q${cursor}` },
          { id: `Q${cursor + 1}` },
        ],
      };
    });

    const source = createWikidataSource();
    await source.connect({ fetch: stub });
    const records = await source.find("entities", { query: "x" }, { limit: 2, offset: 7 });
    expect(records.map((row) => row.id)).toEqual(["Q7", "Q8"]);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get("continue")).toBe("7");
  });

  test("rejects unsupported collections", async () => {
    const source = createWikidataSource();
    await source.connect({ fetch: makeFetchStub(() => ({})).stub });
    await expect(source.get("properties", "P31")).rejects.toMatchObject({ code: "wikidata.unknown_collection" });
    await expect(source.find("properties", { query: "x" })).rejects.toMatchObject({ code: "wikidata.unknown_collection" });
  });

  test("respects an explicit base_url override", async () => {
    const { stub, calls } = makeFetchStub(() => entityResponse("Q42", { labels: { en: { value: "Douglas Adams" } } }));
    const source = createWikidataSource();
    await source.connect({ base_url: "https://test.wikidata.example/", fetch: stub });
    await source.get("entities", "Q42");
    expect(new URL(calls[0]!.url).origin).toBe("https://test.wikidata.example");
    expect(new URL(calls[0]!.url).pathname).toBe("/wiki/Special:EntityData/Q42.json");
  });
});
