import { afterEach, describe, expect, test } from "vitest";

import { createOsmAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const eiffelWay = {
  elements: [{
    type: "way",
    id: 5013364,
    nodes: [1, 2, 3],
    tags: { name: "Tour Eiffel", wikidata: "Q243", wikipedia: "fr:Tour Eiffel", "brand:wikidata": "Q999" },
  }],
};

describe("createOsmAdapter", () => {
  test("is a named, read-only surface with one elements collection", async () => {
    const adapter = createOsmAdapter();
    expect(adapter.name).toBe("osm");
    await adapter.connect({ url: "https://api.openstreetmap.org" });
    const schema = await adapter.introspect();
    expect([...schema.collections.keys()]).toEqual(["elements"]);
    expect(schema.collections.get("elements")?.fields.get("type")?.enum).toEqual(["node", "way", "relation"]);

    await expect(adapter.create("elements", {})).rejects.toThrow(/read-only/i);
    await expect(adapter.update("elements", "node/1", {})).rejects.toThrow(/read-only/i);
    await expect(adapter.delete("elements", "node/1")).rejects.toThrow(/read-only/i);
  });

  test("get parses the type-prefixed id and maps tags + externalIds", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json(eiffelWay);
    }) as unknown as typeof fetch;

    const adapter = createOsmAdapter();
    await adapter.connect({ url: "https://api.openstreetmap.org" });
    const record = await adapter.get("elements", "way/5013364");

    expect(calls[0]).toContain("/api/0.6/way/5013364.json");
    expect(record.id).toBe("way/5013364");
    expect(record.name).toBe("Tour Eiffel");
    expect((record.externalIds as Record<string, string[]>).wikidata).toEqual(["Q243"]);
    // brand:wikidata stays in tags only.
    expect((record.tags as Record<string, string>)["brand:wikidata"]).toBe("Q999");
    expect(record.nodes).toEqual([1, 2, 3]);
  });

  test("get rejects ids without a type prefix", async () => {
    const adapter = createOsmAdapter();
    await adapter.connect({ url: "https://api.openstreetmap.org" });
    await expect(adapter.get("elements", "5013364")).rejects.toThrow(/"<type>\/<id>"/);
    await expect(adapter.get("elements", "city/1")).rejects.toThrow(/<type>\/<id>/);
  });

  test("deleted elements (410) map to not_found", async () => {
    globalThis.fetch = (async () => new Response("Gone", { status: 410 })) as unknown as typeof fetch;
    const adapter = createOsmAdapter();
    await adapter.connect({ url: "https://api.openstreetmap.org" });
    await expect(adapter.get("elements", "node/1")).rejects.toThrow(/deleted/i);
  });

  test("find searches Nominatim with extratags and builds prefixed ids", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json([
        {
          osm_type: "way",
          osm_id: 5013364,
          display_name: "Tour Eiffel, Paris, France",
          name: "Tour Eiffel",
          category: "tourism",
          lat: "48.858",
          lon: "2.294",
          extratags: { wikidata: "Q243" },
        },
      ]);
    }) as unknown as typeof fetch;

    const adapter = createOsmAdapter();
    await adapter.connect({ url: "https://api.openstreetmap.org", searchUrl: "https://nominatim.openstreetmap.org" });
    const rows = await adapter.find("elements", { name: "Eiffel Tower" }, { limit: 5 });

    const url = new URL(calls[0]!);
    expect(url.hostname).toBe("nominatim.openstreetmap.org");
    expect(url.searchParams.get("extratags")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(rows[0]).toMatchObject({
      id: "way/5013364",
      type: "way",
      name: "Tour Eiffel",
      lat: 48.858,
      externalIds: { wikidata: ["Q243"] },
    });
  });

  test("find validation: offset and sort are unsupported", async () => {
    const adapter = createOsmAdapter();
    await adapter.connect({ url: "https://api.openstreetmap.org" });
    await expect(adapter.find("elements", { name: "x" }, { offset: 10 })).rejects.toThrow(/--offset/);
    await expect(adapter.find("elements", { name: "x" }, { sort: "name" })).rejects.toThrow(/--sort/);
    await expect(adapter.find("nodes", { name: "x" })).rejects.toThrow(/no collection "nodes"/);
  });
});
