import { afterEach, describe, expect, test } from "vitest";

import { createCrossRefAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const elifeWork = {
  DOI: "10.7554/eLife.02181",
  type: "journal-article",
  title: ["Requirement for highly efficient pre-mRNA splicing"],
  "container-title": ["eLife"],
  publisher: "eLife Sciences Publications, Ltd",
  issued: { "date-parts": [[2014, 2, 11]] },
  author: [
    { given: "Jane", family: "Doe", ORCID: "https://orcid.org/0000-0002-1641-3403" },
    { given: "John", family: "Smith" },
  ],
  funder: [
    { name: "FCT", DOI: "10.13039/501100001871", award: ["X-1"] },
    { name: "No-DOI funder" },
  ],
  ISSN: ["2050-084X"],
};

describe("createCrossRefAdapter", () => {
  test("is a named, read-only surface with one works collection", async () => {
    const adapter = createCrossRefAdapter();
    expect(adapter.name).toBe("crossref");
    await adapter.connect({ url: "https://api.crossref.org" });
    const schema = await adapter.introspect();
    expect([...schema.collections.keys()]).toEqual(["works"]);
    await expect(adapter.create("works", {})).rejects.toThrow(/read-only/i);
  });

  test("get normalizes the DOI, encodes the path, and extracts externalIds", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ message: elifeWork });
    }) as unknown as typeof fetch;

    const adapter = createCrossRefAdapter();
    await adapter.connect({ url: "https://api.crossref.org" });
    const record = await adapter.get("works", "https://doi.org/10.7554/eLife.02181");

    expect(calls[0]).toContain("/works/10.7554/elife.02181");
    expect(record.id).toBe("10.7554/elife.02181");
    expect(record.title).toContain("pre-mRNA splicing");
    expect(record.container_title).toBe("eLife");
    expect(record.issued).toBe("2014-02-11");
    expect(record.authors).toEqual([
      { name: "Jane Doe", orcid: "0000-0002-1641-3403" },
      { name: "John Smith" },
    ]);
    expect(record.externalIds).toEqual({
      orcid: ["0000-0002-1641-3403"],
      funder_doi: ["10.13039/501100001871"], // funders without a DOI are skipped
      issn: ["2050-084X"],
    });
  });

  test("404 names the other-agency possibility", async () => {
    globalThis.fetch = (async () => new Response("Resource not found.", { status: 404 })) as unknown as typeof fetch;
    const adapter = createCrossRefAdapter();
    await adapter.connect({ url: "https://api.crossref.org" });
    await expect(adapter.get("works", "10.9999/nope")).rejects.toThrow(/DataCite/i);
  });

  test("find maps title to query.bibliographic and orcid to a filter (reverse pivot)", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ message: { "total-results": 1, items: [elifeWork] } });
    }) as unknown as typeof fetch;

    const adapter = createCrossRefAdapter();
    await adapter.connect({ url: "https://api.crossref.org" });

    await adapter.find("works", { title: "splicing" }, { limit: 5, offset: 10 });
    let url = new URL(calls[0]!);
    expect(url.searchParams.get("query.bibliographic")).toBe("splicing");
    expect(url.searchParams.get("rows")).toBe("5");
    expect(url.searchParams.get("offset")).toBe("10");

    const rows = await adapter.find("works", { orcid: "https://orcid.org/0000-0002-1641-3403" });
    url = new URL(calls[1]!);
    expect(url.searchParams.get("filter")).toBe("orcid:0000-0002-1641-3403");
    expect(rows[0]).toMatchObject({ id: "10.7554/elife.02181", title: expect.stringContaining("splicing") });
    // Summaries are compact: no authors/externalIds.
    expect(rows[0]!.authors).toBeUndefined();
  });

  test("mailto joins the polite pool as a query param", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ message: elifeWork });
    }) as unknown as typeof fetch;

    const adapter = createCrossRefAdapter();
    await adapter.connect({ url: "https://api.crossref.org", mailto: "brent@example.com" });
    await adapter.get("works", "10.7554/elife.02181");
    expect(new URL(calls[0]!).searchParams.get("mailto")).toBe("brent@example.com");
  });

  test("validation: invalid DOI, sort unsupported, unfiltered find, unknown collection", async () => {
    const adapter = createCrossRefAdapter();
    await adapter.connect({ url: "https://api.crossref.org" });
    await expect(adapter.get("works", "not-a-doi")).rejects.toThrow(/not a valid DOI/i);
    await expect(adapter.find("works", { title: "x" }, { sort: "title" })).rejects.toThrow(/--sort/);
    await expect(adapter.find("works", { foo: "bar" })).rejects.toThrow(/title=<text>/);
    await expect(adapter.get("funders", "x")).rejects.toThrow(/no collection "funders"/);
  });
});
