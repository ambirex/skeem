import { describe, expect, test } from "vitest";

import { SkemError, UsageError, ValidationError } from "../errors/index.js";
import {
  applyEnrichment,
  getPath,
  parseEnrichSpec,
  parseMapEntries,
  pickEnrichmentMatch,
  resolveSourceEntry,
} from "./enrich.js";
import type { Collection, EntityRecord, Field, FieldType, InputNode } from "../types/index.js";

function field(name: string, type: FieldType, required = false): [string, Field] {
  return [name, { name, type, required, unique: false }];
}

const moviesCollection: Collection = {
  name: "movies",
  primaryKey: "id",
  fields: new Map([
    field("id", "integer", true),
    field("title", "string", true),
    field("release_date", "string"),
    field("overview", "text"),
    field("imdb_id", "string"),
    field("ratings", "string"),
    field("meta", "json"),
    field("tags", "csv"),
    field("company_id", "integer"),
  ]),
  relations: [
    { type: "m2o", field: "company_id", relatedCollection: "companies", relatedField: "id" },
  ],
  uniqueConstraints: [],
};

// Shaped like a reference-adapter envelope: carries its own id, junk fields the
// target schema lacks, a same-named relation field, and array-valued externalIds.
const sourceRecord: EntityRecord = {
  id: 603,
  title: "The Matrix",
  release_date: "1999-03-30",
  overview: "A computer hacker learns the truth.",
  vote_average: 8.2,
  company_id: 999,
  externalIds: { imdb: ["tt0133093"], wikidata: ["Q83495"], empty: [] },
};

const emptyNode: InputNode = { fields: {}, children: {} };

describe("parseEnrichSpec", () => {
  test("parses the id form and coerces digit-only ids", () => {
    expect(parseEnrichSpec("tmdb:movies:603")).toEqual({
      kind: "id",
      source: "tmdb",
      collection: "movies",
      id: 603,
      raw: "tmdb:movies:603",
    });
  });

  test("keeps colon-bearing ids verbatim (CrossRef DOIs)", () => {
    const spec = parseEnrichSpec("crossref:works:doi:10.1000/a:b");
    expect(spec).toMatchObject({ kind: "id", source: "crossref", collection: "works", id: "doi:10.1000/a:b" });
  });

  test("a ? after the id separator stays part of the id", () => {
    const spec = parseEnrichSpec("crossref:works:10.1000/ab?cd");
    expect(spec).toMatchObject({ kind: "id", id: "10.1000/ab?cd" });
  });

  test("parses the find form", () => {
    expect(parseEnrichSpec("tmdb:movies?title=The Matrix")).toEqual({
      kind: "find",
      source: "tmdb",
      collection: "movies",
      filter: { title: "The Matrix" },
      raw: "tmdb:movies?title=The Matrix",
    });
  });

  test("find values may contain colons", () => {
    const spec = parseEnrichSpec("tmdb:movies?title=Mission: Impossible");
    expect(spec).toMatchObject({ kind: "find", collection: "movies", filter: { title: "Mission: Impossible" } });
  });

  test("find values use the same scalar coercion as --where", () => {
    expect(parseEnrichSpec("tmdb:movies?year=1999")).toMatchObject({ filter: { year: 1999 } });
  });

  test.each([
    "",
    "tmdb",
    "tmdb:",
    ":movies:1",
    "tmdb:movies",
    "tmdb:movies:",
    "tmdb:movies?title",
    "tmdb:movies?=value",
  ])("rejects malformed spec %j with the grammar reminder", (raw) => {
    expect(() => parseEnrichSpec(raw)).toThrowError(UsageError);
    expect(() => parseEnrichSpec(raw)).toThrowError(/Expected "<source>:<collection>:<id>"/);
  });
});

describe("parseMapEntries", () => {
  test("parses repeatable entries with dotted source paths", () => {
    expect(parseMapEntries(["externalIds.imdb=imdb_id", "overview=ratings"])).toEqual([
      { sourcePath: "externalIds.imdb", targetField: "imdb_id", raw: "externalIds.imdb=imdb_id" },
      { sourcePath: "overview", targetField: "ratings", raw: "overview=ratings" },
    ]);
  });

  test("rejects duplicate targets", () => {
    expect(() => parseMapEntries(["a=x", "b=x"])).toThrowError(/more than once/);
  });

  test.each(["ax", "=x", "a="])("rejects malformed entry %j", (raw) => {
    expect(() => parseMapEntries([raw])).toThrowError(UsageError);
  });

  test("rejects dotted targets", () => {
    expect(() => parseMapEntries(["a=b.c"])).toThrowError(/top-level field/);
  });
});

describe("resolveSourceEntry", () => {
  const sources = {
    tmdb: { adapter: "tmdb", connection: { url: "https://api.themoviedb.org/3", token: "t" } },
  };

  test("returns adapter and connection for a configured source", () => {
    expect(resolveSourceEntry(sources, "tmdb")).toEqual({
      adapter: "tmdb",
      connection: { url: "https://api.themoviedb.org/3", token: "t" },
    });
  });

  test("unknown name lists the configured sources", () => {
    expect(() => resolveSourceEntry(sources, "nosuch")).toThrowError(/Configured sources: tmdb/);
  });

  test("absent sources block gets its own hint", () => {
    expect(() => resolveSourceEntry({}, "tmdb")).toThrowError(/Add a "sources:" block/);
  });

  test("missing adapter or url is reported per entry", () => {
    expect(() => resolveSourceEntry({ x: { connection: { url: "http://x" } } }, "x")).toThrowError(/missing "adapter"/);
    expect(() => resolveSourceEntry({ x: { adapter: "tmdb" } }, "x")).toThrowError(/missing "connection.url"/);
  });
});

describe("getPath", () => {
  test("resolves nested paths and misses to undefined", () => {
    expect(getPath({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(getPath({ a: { b: 1 } }, "a.c")).toBeUndefined();
    expect(getPath({ a: { b: 1 } }, "a.b.c")).toBeUndefined();
    expect(getPath({ a: "leaf" }, "a.b")).toBeUndefined();
  });

  test("arrays are terminal-only", () => {
    expect(getPath({ a: { b: ["x"] } }, "a.b")).toEqual(["x"]);
    expect(getPath({ a: [{ b: 1 }] }, "a.b")).toBeUndefined();
  });
});

describe("pickEnrichmentMatch", () => {
  const spec = parseEnrichSpec("tmdb:movies?title=x");
  if (spec.kind !== "find") {
    throw new Error("Expected a find spec.");
  }

  test("zero matches is NOT_FOUND with attribution", () => {
    try {
      pickEnrichmentMatch(spec, []);
      throw new Error("Expected pickEnrichmentMatch to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SkemError);
      const skem = error as SkemError;
      expect(skem.code).toBe("NOT_FOUND");
      expect(skem.message).toContain("nothing to enrich from");
      expect(skem.details).toEqual({ enrich: { source: "tmdb", collection: "movies", filter: { title: "x" } } });
    }
  });

  test("multiple matches is AMBIGUOUS", () => {
    try {
      pickEnrichmentMatch(spec, [{ id: 1 }, { id: 2 }]);
      throw new Error("Expected pickEnrichmentMatch to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SkemError);
      const skem = error as SkemError;
      expect(skem.code).toBe("AMBIGUOUS");
      expect(skem.message).toContain("narrower filter");
    }
  });

  test("a single match is returned", () => {
    expect(pickEnrichmentMatch(spec, [{ id: 603 }])).toEqual({ id: 603 });
  });
});

describe("applyEnrichment", () => {
  test("name-match fills unset schema fields and drops junk", () => {
    const { node, enrichedFields } = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [],
    });
    expect(node.fields).toEqual({
      title: "The Matrix",
      release_date: "1999-03-30",
      overview: "A computer hacker learns the truth.",
    });
    expect(enrichedFields).toEqual(["overview", "release_date", "title"]);
  });

  test("user fields always win", () => {
    const { node, enrichedFields } = applyEnrichment({
      node: { fields: { title: "User Title" }, children: {} },
      record: sourceRecord,
      collection: moviesCollection,
      maps: [],
    });
    expect(node.fields.title).toBe("User Title");
    expect(enrichedFields).not.toContain("title");
  });

  test("nested relation input counts as user-set", () => {
    const { node, enrichedFields } = applyEnrichment({
      node: { fields: {}, children: { overview: { fields: {}, children: {} } } },
      record: sourceRecord,
      collection: moviesCollection,
      maps: [],
    });
    expect(node.fields).not.toHaveProperty("overview");
    expect(enrichedFields).not.toContain("overview");
  });

  test("reserved (match) keys are never enriched", () => {
    const { node, enrichedFields } = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [{ sourcePath: "externalIds.imdb", targetField: "imdb_id", raw: "externalIds.imdb=imdb_id" }],
      reserved: new Set(["imdb_id", "title"]),
    });
    expect(node.fields).not.toHaveProperty("imdb_id");
    expect(node.fields).not.toHaveProperty("title");
    expect(enrichedFields).toEqual(["overview", "release_date"]);
  });

  test("the target primary key is never name-matched", () => {
    const { node } = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [],
    });
    expect(node.fields).not.toHaveProperty("id");
  });

  test("relation fields are skipped by name-match", () => {
    const { node } = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [],
    });
    expect(node.fields).not.toHaveProperty("company_id");
  });

  test("null source values are skipped", () => {
    const { node, enrichedFields } = applyEnrichment({
      node: emptyNode,
      record: { overview: null, title: "The Matrix" },
      collection: moviesCollection,
      maps: [],
    });
    expect(node.fields).toEqual({ title: "The Matrix" });
    expect(enrichedFields).toEqual(["title"]);
  });

  test("--map takes [0] of an array onto a scalar target", () => {
    const { node, enrichedFields } = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [{ sourcePath: "externalIds.imdb", targetField: "imdb_id", raw: "externalIds.imdb=imdb_id" }],
    });
    expect(node.fields.imdb_id).toBe("tt0133093");
    expect(enrichedFields).toContain("imdb_id");
  });

  test("arrays land whole on json and csv targets", () => {
    const { node } = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [
        { sourcePath: "externalIds.imdb", targetField: "meta", raw: "externalIds.imdb=meta" },
        { sourcePath: "externalIds.wikidata", targetField: "tags", raw: "externalIds.wikidata=tags" },
      ],
    });
    expect(node.fields.meta).toEqual(["tt0133093"]);
    expect(node.fields.tags).toEqual(["Q83495"]);
  });

  test("--map skips silently on missing or empty-array source paths", () => {
    const { node, enrichedFields } = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [
        { sourcePath: "externalIds.nope", targetField: "imdb_id", raw: "externalIds.nope=imdb_id" },
        { sourcePath: "externalIds.empty", targetField: "ratings", raw: "externalIds.empty=ratings" },
      ],
    });
    expect(node.fields).not.toHaveProperty("imdb_id");
    expect(node.fields).not.toHaveProperty("ratings");
    expect(enrichedFields).toEqual(["overview", "release_date", "title"]);
  });

  test("--map errors on unknown targets and the primary key", () => {
    expect(() =>
      applyEnrichment({
        node: emptyNode,
        record: sourceRecord,
        collection: moviesCollection,
        maps: [{ sourcePath: "title", targetField: "nope", raw: "title=nope" }],
      }),
    ).toThrowError(ValidationError);

    expect(() =>
      applyEnrichment({
        node: emptyNode,
        record: sourceRecord,
        collection: moviesCollection,
        maps: [{ sourcePath: "externalIds.imdb", targetField: "id", raw: "externalIds.imdb=id" }],
      }),
    ).toThrowError(/primary key/);
  });

  test("--map beats name-match for its target; user-set targets win over both", () => {
    const mapped = applyEnrichment({
      node: emptyNode,
      record: sourceRecord,
      collection: moviesCollection,
      maps: [{ sourcePath: "overview", targetField: "release_date", raw: "overview=release_date" }],
    });
    expect(mapped.node.fields.release_date).toBe("A computer hacker learns the truth.");

    const userSet = applyEnrichment({
      node: { fields: { imdb_id: "user-value" }, children: {} },
      record: sourceRecord,
      collection: moviesCollection,
      maps: [{ sourcePath: "externalIds.imdb", targetField: "imdb_id", raw: "externalIds.imdb=imdb_id" }],
    });
    expect(userSet.node.fields.imdb_id).toBe("user-value");
    expect(userSet.enrichedFields).not.toContain("imdb_id");
  });

  test("objects: --map onto non-json errors, name-match skips, json accepts", () => {
    expect(() =>
      applyEnrichment({
        node: emptyNode,
        record: sourceRecord,
        collection: moviesCollection,
        maps: [{ sourcePath: "externalIds", targetField: "imdb_id", raw: "externalIds=imdb_id" }],
      }),
    ).toThrowError(/not json/);

    const nameMatched = applyEnrichment({
      node: emptyNode,
      record: { ratings: { avg: 8.2 }, meta: { source: "tmdb" } },
      collection: moviesCollection,
      maps: [],
    });
    expect(nameMatched.node.fields).not.toHaveProperty("ratings");
    expect(nameMatched.node.fields.meta).toEqual({ source: "tmdb" });
  });

  test("enrichedFields is sorted and empty when nothing applies", () => {
    const { enrichedFields } = applyEnrichment({
      node: emptyNode,
      record: { vote_average: 8.2, id: 603 },
      collection: moviesCollection,
      maps: [],
    });
    expect(enrichedFields).toEqual([]);
  });

  test("the input node is never mutated", () => {
    const node: InputNode = { fields: { title: "User Title" }, children: {} };
    applyEnrichment({ node, record: sourceRecord, collection: moviesCollection, maps: [] });
    expect(node).toEqual({ fields: { title: "User Title" }, children: {} });
  });
});
