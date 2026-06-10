import { afterEach, describe, expect, test } from "vitest";

import { createOpenLibraryAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createOpenLibraryAdapter", () => {
  test("is a named, read-only surface with three collections", async () => {
    const adapter = createOpenLibraryAdapter();
    expect(adapter.name).toBe("openlibrary");
    await adapter.connect({ url: "https://openlibrary.org" });
    const schema = await adapter.introspect();
    expect([...schema.collections.keys()].sort()).toEqual(["authors", "editions", "works"]);
    await expect(adapter.create("works", {})).rejects.toThrow(/read-only/i);
  });

  test("get authors maps remote_ids into externalIds (and strips path prefixes)", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({
        key: "/authors/OL272947A",
        name: "Douglas Adams",
        birth_date: "11 March 1952",
        remote_ids: {
          wikidata: "Q42",
          viaf: "113230702",
          isni: "0000 0000 8045 6315",
          musicbrainz: "e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4",
          goodreads: "4",
          imdb: "nm0010930",
          project_gutenberg: "1234",
        },
      });
    }) as unknown as typeof fetch;

    const adapter = createOpenLibraryAdapter();
    await adapter.connect({ url: "https://openlibrary.org" });
    const record = await adapter.get("authors", "/authors/OL272947A");

    expect(calls[0]).toContain("/authors/OL272947A.json");
    expect(record.id).toBe("OL272947A");
    expect(record.externalIds).toEqual({
      wikidata: ["Q42"],
      viaf: ["113230702"],
      isni: ["0000000080456315"],
      musicbrainz_artist: ["e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4"],
      goodreads_author: ["4"],
      imdb: ["nm0010930"],
      project_gutenberg: ["1234"], // unknown remote_ids pass through
    });
  });

  test("get editions surfaces ISBN/OCLC/LCCN and the work refs; via /books/", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({
        key: "/books/OL27297031M",
        title: "The Hitchhiker's Guide to the Galaxy",
        isbn_10: ["0-345-39180-2"],
        isbn_13: ["9780345391803"],
        oclc_numbers: ["32348443"],
        identifiers: { goodreads: ["386162"] },
        works: [{ key: "/works/OL2163649W" }],
      });
    }) as unknown as typeof fetch;

    const adapter = createOpenLibraryAdapter();
    await adapter.connect({ url: "https://openlibrary.org" });
    const record = await adapter.get("editions", "OL27297031M");

    expect(calls[0]).toContain("/books/OL27297031M.json"); // editions live under /books/
    expect(record.works).toEqual(["OL2163649W"]);
    expect(record.externalIds).toEqual({
      isbn_10: ["0345391802"],
      isbn_13: ["9780345391803"],
      oclc: ["32348443"],
      goodreads_book: ["386162"],
    });
  });

  test("get follows one /type/redirect hop (merged records)", async () => {
    let call = 0;
    globalThis.fetch = (async (url: string | URL) => {
      call += 1;
      if (call === 1) {
        return json({ key: "/works/OL1W", type: { key: "/type/redirect" }, location: "/works/OL2W" });
      }
      expect(String(url)).toContain("/works/OL2W.json");
      return json({ key: "/works/OL2W", title: "Merged", type: { key: "/type/work" } });
    }) as unknown as typeof fetch;

    const adapter = createOpenLibraryAdapter();
    await adapter.connect({ url: "https://openlibrary.org" });
    const record = await adapter.get("works", "OL1W");
    expect(record.id).toBe("OL2W");
    expect(record.title).toBe("Merged");
  });

  test("works description normalizes string-or-object", async () => {
    globalThis.fetch = (async () =>
      json({ key: "/works/OL1W", title: "T", description: { type: "/type/text", value: "A novel." } })
    ) as unknown as typeof fetch;

    const adapter = createOpenLibraryAdapter();
    await adapter.connect({ url: "https://openlibrary.org" });
    const record = await adapter.get("works", "OL1W");
    expect(record.description).toBe("A novel.");
  });

  test("find editions by ISBN normalizes (zero-pad) and returns one row; 404 -> []", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ key: "/books/OL3M", title: "Found", isbn_10: ["0261103563"] });
    }) as unknown as typeof fetch;

    const adapter = createOpenLibraryAdapter();
    await adapter.connect({ url: "https://openlibrary.org" });
    // The CLI coerces 0261103563 to the number 261103563.
    const rows = await adapter.find("editions", { isbn: 261103563 });

    expect(calls[0]).toContain("/isbn/0261103563.json");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("OL3M");

    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const empty = await adapter.find("editions", { isbn: "9780000000000" });
    expect(empty).toEqual([]);
  });

  test("find works searches /search.json with fields and offset", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ docs: [{ key: "/works/OL2163649W", title: "HHGTTG", first_publish_year: 1979, author_key: ["/authors/OL272947A"] }] });
    }) as unknown as typeof fetch;

    const adapter = createOpenLibraryAdapter();
    await adapter.connect({ url: "https://openlibrary.org" });
    const rows = await adapter.find("works", { title: "Hitchhiker" }, { limit: 5, offset: 10 });

    const url = new URL(calls[0]!);
    expect(url.pathname).toBe("/search.json");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("offset")).toBe("10");
    expect(rows[0]).toMatchObject({ id: "OL2163649W", title: "HHGTTG", author_keys: ["OL272947A"] });
  });

  test("validation: sort unsupported; editions need isbn or id; unknown collection", async () => {
    const adapter = createOpenLibraryAdapter();
    await adapter.connect({ url: "https://openlibrary.org" });
    await expect(adapter.find("works", { title: "x" }, { sort: "title" })).rejects.toThrow(/--sort/);
    await expect(adapter.find("editions", { title: "x" })).rejects.toThrow(/isbn=/);
    await expect(adapter.get("shelves", "x")).rejects.toThrow(/no collection "shelves"/);
  });
});
