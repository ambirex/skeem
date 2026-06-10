import { afterEach, describe, expect, test } from "vitest";

import { createMusicBrainzAdapter } from "./adapter.js";
import { MusicBrainzClient } from "./client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const nirvana = {
  id: "5b11f4ce-a62d-471e-81fc-a69a8278c7da",
  name: "Nirvana",
  "sort-name": "Nirvana",
  type: "Group",
  country: "US",
  disambiguation: "1980s–1990s US grunge band",
  isnis: ["0000 0001 0786 9412"],
  relations: [
    { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q11649" } },
    { type: "discogs", url: { resource: "https://www.discogs.com/artist/125246" } },
  ],
};

describe("createMusicBrainzAdapter", () => {
  test("is a named, read-only surface with six collections", async () => {
    const adapter = createMusicBrainzAdapter();
    expect(adapter.name).toBe("musicbrainz");
    expect(adapter.createCollection).toBeUndefined();
    expect(adapter.link).toBeUndefined();

    await adapter.connect({ url: "https://musicbrainz.org" });
    const schema = await adapter.introspect();
    expect([...schema.collections.keys()].sort()).toEqual(
      ["artists", "labels", "recordings", "release_groups", "releases", "works"],
    );
    expect(schema.collections.get("artists")?.fields.get("id")?.type).toBe("uuid");
    expect(schema.collections.get("artists")?.fields.has("externalIds")).toBe(true);

    await expect(adapter.create("artists", {})).rejects.toThrow(/read-only/i);
    await expect(adapter.update("artists", "x", {})).rejects.toThrow(/read-only/i);
    await expect(adapter.delete("artists", "x")).rejects.toThrow(/read-only/i);
  });

  test("get maps hyphenated fields and extracts externalIds + links", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json(nirvana);
    }) as unknown as typeof fetch;

    const adapter = createMusicBrainzAdapter();
    await adapter.connect({ url: "https://musicbrainz.org" });
    const record = await adapter.get("artists", nirvana.id);

    expect(calls[0]).toContain(`/ws/2/artist/${nirvana.id}`);
    expect(calls[0]).toContain("inc=url-rels");
    expect(calls[0]).toContain("fmt=json");
    expect(record.name).toBe("Nirvana");
    expect(record.sort_name).toBe("Nirvana");
    expect(record.externalIds).toEqual({
      wikidata: ["Q11649"],
      isni: ["0000000107869412"],
    });
    expect((record.links as Record<string, string[]>).discogs).toEqual(["https://www.discogs.com/artist/125246"]);
  });

  test("find quotes the query as a Lucene phrase and passes offset", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ artists: [{ id: "mbid-1", name: "Nirvana (UK)", type: "Group", score: 90 }] });
    }) as unknown as typeof fetch;

    const adapter = createMusicBrainzAdapter();
    await adapter.connect({ url: "https://musicbrainz.org" });
    const rows = await adapter.find("artists", { name: 'Nirvana "live"' }, { limit: 5, offset: 10 });

    const url = new URL(calls[0]!);
    expect(url.searchParams.get("query")).toBe('"Nirvana \\"live\\""');
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("offset")).toBe("10");
    expect(rows[0]).toMatchObject({ id: "mbid-1", name: "Nirvana (UK)", score: 90 });
  });

  test("find validation: sort unsupported, missing filter lists supported keys", async () => {
    const adapter = createMusicBrainzAdapter();
    await adapter.connect({ url: "https://musicbrainz.org" });
    await expect(adapter.find("artists", { name: "x" }, { sort: "name" })).rejects.toThrow(/--sort/i);
    await expect(adapter.find("works", { foo: "bar" })).rejects.toThrow(/title=<text>/i);
    await expect(adapter.get("widgets", "x")).rejects.toThrow(/no collection "widgets"/i);
  });

  test("404 maps to not_found; 503 surfaces the rate-limit hint", async () => {
    globalThis.fetch = (async () => json({ error: "Not Found" }, 404)) as unknown as typeof fetch;
    const adapter = createMusicBrainzAdapter();
    await adapter.connect({ url: "https://musicbrainz.org" });
    await expect(adapter.get("artists", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/i);

    // Fresh adapter so the in-client throttle doesn't pause the test.
    globalThis.fetch = (async () => json({ error: "overloaded" }, 503)) as unknown as typeof fetch;
    const second = createMusicBrainzAdapter();
    await second.connect({ url: "https://musicbrainz.org" });
    await expect(second.get("artists", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/rate limit/i);
  });

  test("client throttles successive requests by the min interval", async () => {
    globalThis.fetch = (async () => json({ ok: true })) as unknown as typeof fetch;
    const client = new MusicBrainzClient(120);
    client.connect({ url: "https://musicbrainz.org" });

    const started = Date.now();
    await client.get("/ws/2/artist/x");
    await client.get("/ws/2/artist/y");
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });
});
