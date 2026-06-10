import { afterEach, describe, expect, test } from "vitest";

import { createWikiDataAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function mockApi(handler: (action: string, params: URLSearchParams) => unknown) {
  const calls: Array<{ url: string }> = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url));
    calls.push({ url: String(url) });
    return json(handler(u.searchParams.get("action") ?? "", u.searchParams));
  }) as unknown as typeof fetch;
  return calls;
}

const q42 = {
  type: "item",
  id: "Q42",
  labels: { en: { language: "en", value: "Douglas Adams" } },
  descriptions: { en: { language: "en", value: "British writer" } },
  aliases: { en: [{ language: "en", value: "Douglas Noël Adams" }] },
  claims: {
    P31: [{ mainsnak: { snaktype: "value", property: "P31", datatype: "wikibase-item", datavalue: { type: "wikibase-entityid", value: { id: "Q5" } } } }],
    P345: [{ mainsnak: { snaktype: "value", property: "P345", datatype: "external-id", datavalue: { type: "string", value: "nm0010930" } } }],
  },
  sitelinks: {
    enwiki: { site: "enwiki", title: "Douglas Adams", url: "https://en.wikipedia.org/wiki/Douglas_Adams" },
  },
};

describe("createWikiDataAdapter", () => {
  test("is a named, read-only surface", async () => {
    const adapter = createWikiDataAdapter();
    expect(adapter.name).toBe("wikidata");
    for (const method of ["connect", "introspect", "get", "find", "create", "update", "delete", "count"] as const) {
      expect(typeof adapter[method]).toBe("function");
    }
    // No schema mutation or linking.
    expect(adapter.createCollection).toBeUndefined();
    expect(adapter.link).toBeUndefined();

    await adapter.connect({ url: "https://www.wikidata.org" });
    await expect(adapter.create("items", {})).rejects.toThrow(/read-only/i);
    await expect(adapter.update("items", "Q1", {})).rejects.toThrow(/read-only/i);
    await expect(adapter.delete("items", "Q1")).rejects.toThrow(/read-only/i);
  });

  test("introspect exposes items and properties with stable fields", async () => {
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    const schema = await adapter.introspect();

    expect([...schema.collections.keys()].sort()).toEqual(["items", "properties"]);
    const items = schema.collections.get("items")!;
    expect(items.primaryKey).toBe("id");
    expect([...items.fields.keys()].sort()).toEqual(["aliases", "description", "externalIds", "label"]);
  });

  test("get partitions claims into ordinary claims + externalIds (with wikipedia sitelink)", async () => {
    mockApi((action) => {
      if (action === "wbgetentities") return { entities: { Q42: q42 } };
      return {};
    });
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    const record = await adapter.get("items", "Q42");

    expect(record).toEqual({
      id: "Q42",
      label: "Douglas Adams",
      description: "British writer",
      aliases: ["Douglas Noël Adams"],
      claims: { P31: ["Q5"] },
      externalIds: {
        imdb: ["nm0010930"],
        wikipedia: ["https://en.wikipedia.org/wiki/Douglas_Adams"],
      },
    });
  });

  test("find by external id uses haswbstatement and hydrates summaries", async () => {
    const calls = mockApi((action, params) => {
      if (action === "query") {
        expect(params.get("srsearch")).toBe("haswbstatement:P345=nm0010930");
        return { query: { search: [{ title: "Q42" }] } };
      }
      if (action === "wbgetentities") {
        expect(params.get("ids")).toBe("Q42");
        return { entities: { Q42: q42 } };
      }
      return {};
    });
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });

    const rows = await adapter.find("items", { imdb: "NM0010930" }); // imdb lowercased
    expect(rows).toEqual([{ id: "Q42", label: "Douglas Adams", description: "British writer" }]);
    expect(calls.length).toBe(2);
  });

  test("find accepts a raw P-id filter key", async () => {
    mockApi((action, params) => {
      if (action === "query") {
        expect(params.get("srsearch")).toBe("haswbstatement:P434=e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4");
        return { query: { search: [] } };
      }
      return {};
    });
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    const rows = await adapter.find("items", { P434: "e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4" });
    expect(rows).toEqual([]);
  });

  test("external-id find validation: properties collection, combined filters, limit cap, sort", async () => {
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });

    await expect(adapter.find("properties", { imdb: "nm1" })).rejects.toThrow(/items only/i);
    await expect(adapter.find("items", { imdb: "nm1", label: "x" })).rejects.toThrow(/cannot be combined/i);
    await expect(adapter.find("items", { imdb: "nm1" }, { limit: 51 })).rejects.toThrow(/up to 50/i);
    await expect(adapter.find("items", { label: "x" }, { sort: "label" })).rejects.toThrow(/--sort/i);
  });

  test("get throws not_found for a missing entity", async () => {
    mockApi(() => ({ entities: { Q999999999: { id: "Q999999999", missing: "" } } }));
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    await expect(adapter.get("items", "Q999999999")).rejects.toThrow(/no item "Q999999999"/i);
  });

  test("find by label searches and returns summaries", async () => {
    const calls = mockApi((action) => {
      if (action === "wbsearchentities") {
        return { search: [{ id: "Q42", label: "Douglas Adams", description: "British writer" }] };
      }
      return {};
    });
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    const rows = await adapter.find("items", { label: "Douglas Adams" });

    expect(rows).toEqual([{ id: "Q42", label: "Douglas Adams", description: "British writer" }]);
    expect(calls[0]!.url).toContain("type=item");
    expect(calls[0]!.url).toContain("search=Douglas+Adams"); // URLSearchParams encodes spaces as +
  });

  test("find on properties searches the property type", async () => {
    const calls = mockApi(() => ({ search: [{ id: "P31", label: "instance of" }] }));
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    const rows = await adapter.find("properties", { label: "instance of" });

    expect(rows[0]!.id).toBe("P31");
    expect(decodeURIComponent(calls[0]!.url)).toContain("type=property");
  });

  test("find by id returns a summary", async () => {
    mockApi(() => ({ entities: { Q42: q42 } }));
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    const rows = await adapter.find("items", { id: "Q42" });
    expect(rows).toEqual([{ id: "Q42", label: "Douglas Adams", description: "British writer" }]);
  });

  test("find without label, id, or external-id filter is a validation error", async () => {
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    await expect(adapter.find("items", { foo: "bar" })).rejects.toThrow(/label=<text>.*external-id filter/i);
  });

  test("unknown collection is rejected", async () => {
    const adapter = createWikiDataAdapter();
    await adapter.connect({ url: "https://www.wikidata.org" });
    await expect(adapter.get("widgets", "Q1")).rejects.toThrow(/no collection "widgets"/i);
  });
});
