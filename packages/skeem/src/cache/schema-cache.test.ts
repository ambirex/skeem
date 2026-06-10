import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { Schema } from "../types/index.js";
import { SchemaCache } from "./schema-cache.js";

function sampleSchema(): Schema {
  return {
    collections: new Map([
      [
        "people",
        {
          name: "people",
          primaryKey: "id",
          fields: new Map([["name", { name: "name", type: "string" as const, required: false, unique: false }]]),
          relations: [],
          uniqueConstraints: [],
        },
      ],
    ]),
  };
}

describe("SchemaCache", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "skeem-cache-test-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function seed(adapter: string, sourceUrl: string): Promise<void> {
    const writer = new SchemaCache(rootDir, 60_000);
    await writer.write(sampleSchema(), {
      savedAt: new Date().toISOString(),
      adapter,
      sourceUrl,
    });
  }

  test("readFresh returns the schema when adapter and sourceUrl match", async () => {
    await seed("directus", "http://a.test");
    const cache = new SchemaCache(rootDir, 60_000, { adapter: "directus", sourceUrl: "http://a.test" });
    const schema = await cache.readFresh();
    expect(schema?.collections.has("people")).toBe(true);
  });

  test("readFresh misses when the cache was written by a different adapter", async () => {
    await seed("directus", "http://a.test");
    const cache = new SchemaCache(rootDir, 60_000, { adapter: "musicbrainz", sourceUrl: "http://a.test" });
    expect(await cache.readFresh()).toBeUndefined();
  });

  test("readFresh misses when the cache was written for a different backend URL", async () => {
    await seed("directus", "http://a.test");
    const cache = new SchemaCache(rootDir, 60_000, { adapter: "directus", sourceUrl: "http://b.test" });
    expect(await cache.readFresh()).toBeUndefined();
  });

  test("readFresh without a source stays back-compatible (TTL only)", async () => {
    await seed("directus", "http://a.test");
    const cache = new SchemaCache(rootDir, 60_000);
    const schema = await cache.readFresh();
    expect(schema?.collections.has("people")).toBe(true);
  });

  test("readFresh still honors TTL expiry", async () => {
    const writer = new SchemaCache(rootDir, 60_000);
    await writer.write(sampleSchema(), {
      savedAt: new Date(Date.now() - 120_000).toISOString(),
      adapter: "directus",
      sourceUrl: "http://a.test",
    });
    const cache = new SchemaCache(rootDir, 60_000, { adapter: "directus", sourceUrl: "http://a.test" });
    expect(await cache.readFresh()).toBeUndefined();
  });
});
