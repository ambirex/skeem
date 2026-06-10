import { afterEach, describe, expect, test } from "vitest";

import { createPocketBaseAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pbListResponse<T>(items: T[], totalItems?: number): Response {
  return jsonResponse({ items, page: 1, perPage: 500, totalItems: totalItems ?? items.length, totalPages: 1 });
}

describe("createPocketBaseAdapter", () => {
  test("returns a named adapter surface", () => {
    const adapter = createPocketBaseAdapter();
    expect(adapter.name).toBe("pocketbase");
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.introspect).toBe("function");
    expect(typeof adapter.create).toBe("function");
    expect(typeof adapter.createCollection).toBe("function");
    expect(typeof adapter.createField).toBe("function");
    expect(typeof adapter.updateField).toBe("function");
    expect(typeof adapter.createRelation).toBe("function");
    expect(typeof adapter.updateRelation).toBe("function");
    expect(typeof adapter.deleteField).toBe("function");
    expect(typeof adapter.deleteRelation).toBe("function");
    expect(typeof adapter.deleteCollection).toBe("function");
  });

  test("introspect skips system collections and system fields", async () => {
    globalThis.fetch = (async () =>
      pbListResponse([
        {
          id: "col1",
          name: "articles",
          type: "base",
          system: false,
          fields: [
            { name: "id", type: "text", system: true },
            { name: "title", type: "text", system: false, required: true },
            { name: "created", type: "autodate", system: true },
          ],
          indexes: [],
        },
        {
          id: "sys1",
          name: "_superusers",
          type: "auth",
          system: true,
          fields: [],
          indexes: [],
        },
      ])
    ) as unknown as typeof fetch;

    const adapter = createPocketBaseAdapter();
    await adapter.connect({ url: "http://example.test" });
    const schema = await adapter.introspect();

    expect(schema.collections.has("articles")).toBe(true);
    expect(schema.collections.has("_superusers")).toBe(false);
    const fields = schema.collections.get("articles")?.fields;
    expect(fields?.has("title")).toBe(true);
    expect(fields?.has("id")).toBe(false);
    expect(fields?.has("created")).toBe(false);
  });

  test("introspect maps select field to string + enum", async () => {
    globalThis.fetch = (async () =>
      pbListResponse([
        {
          id: "col1",
          name: "articles",
          type: "base",
          system: false,
          fields: [
            {
              name: "status",
              type: "select",
              required: false,
              system: false,
              values: ["draft", "published"],
              maxSelect: 1,
            },
          ],
          indexes: [],
        },
      ])
    ) as unknown as typeof fetch;

    const adapter = createPocketBaseAdapter();
    await adapter.connect({ url: "http://example.test" });
    const schema = await adapter.introspect();

    const status = schema.collections.get("articles")?.fields.get("status");
    expect(status?.type).toBe("string");
    expect(status?.enum).toEqual(["draft", "published"]);
  });

  test("introspect parses unique indexes into field.unique", async () => {
    globalThis.fetch = (async () =>
      pbListResponse([
        {
          id: "col1",
          name: "companies",
          type: "base",
          system: false,
          fields: [
            { name: "code", type: "text", required: false, system: false },
          ],
          indexes: ["CREATE UNIQUE INDEX `idx_companies_code` ON `companies` (`code`)"],
        },
      ])
    ) as unknown as typeof fetch;

    const adapter = createPocketBaseAdapter();
    await adapter.connect({ url: "http://example.test" });
    const schema = await adapter.introspect();

    expect(schema.collections.get("companies")?.fields.get("code")?.unique).toBe(true);
    expect(schema.collections.get("companies")?.uniqueConstraints).toEqual([{ fields: ["code"] }]);
  });

  test("introspect maps m2o relation field into relations (not fields)", async () => {
    globalThis.fetch = (async () =>
      pbListResponse([
        {
          id: "col1",
          name: "people",
          type: "base",
          system: false,
          fields: [
            { name: "name", type: "text", system: false },
            {
              name: "company",
              type: "relation",
              system: false,
              collectionId: "col2",
              collectionName: "companies",
              maxSelect: 1,
              cascadeDelete: false,
            },
          ],
          indexes: [],
        },
        {
          id: "col2",
          name: "companies",
          type: "base",
          system: false,
          fields: [{ name: "name", type: "text", system: false }],
          indexes: [],
        },
      ])
    ) as unknown as typeof fetch;

    const adapter = createPocketBaseAdapter();
    await adapter.connect({ url: "http://example.test" });
    const schema = await adapter.introspect();

    const people = schema.collections.get("people");
    // relation field is NOT in fields
    expect(people?.fields.has("company")).toBe(false);
    // relation IS in relations
    expect(people?.relations).toEqual([
      { type: "m2o", field: "company", relatedCollection: "companies", relatedField: "id" },
    ]);
  });

  test("introspect maps m2m relation field (maxSelect > 1) as m2m", async () => {
    globalThis.fetch = (async () =>
      pbListResponse([
        {
          id: "col1",
          name: "articles",
          type: "base",
          system: false,
          fields: [
            {
              name: "tags",
              type: "relation",
              system: false,
              collectionId: "col2",
              collectionName: "tags",
              maxSelect: null,
            },
          ],
          indexes: [],
        },
        {
          id: "col2",
          name: "tags",
          type: "base",
          system: false,
          fields: [{ name: "name", type: "text", system: false }],
          indexes: [],
        },
      ])
    ) as unknown as typeof fetch;

    const adapter = createPocketBaseAdapter();
    await adapter.connect({ url: "http://example.test" });
    const schema = await adapter.introspect();

    const articles = schema.collections.get("articles");
    expect(articles?.relations[0]?.type).toBe("m2m");
    expect(articles?.relations[0]?.relatedCollection).toBe("tags");
  });

  test("createField emits a select field with values for enum fields", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let callCount = 0;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      callCount++;
      if (callCount === 1) {
        // GET collection
        return jsonResponse({
          id: "col1",
          name: "articles",
          type: "base",
          system: false,
          fields: [],
          indexes: [],
        });
      }
      return jsonResponse({ id: "col1", name: "articles", type: "base", system: false, fields: [], indexes: [] });
    }) as unknown as typeof fetch;

    const adapter = createPocketBaseAdapter();
    await adapter.connect({ url: "http://example.test" });
    await adapter.createField!("articles", { name: "status", type: "string", enum: ["draft", "published"] });

    const patch = calls.find((c) => c.url.includes("/api/collections/articles") && c.body);
    const newField = (patch?.body as { fields: PocketBaseField[] })?.fields?.[0];
    expect(newField?.type).toBe("select");
    expect(newField?.values).toEqual(["draft", "published"]);
    expect(newField?.maxSelect).toBe(1);
  });
});

// Local type import for test assertions
interface PocketBaseField {
  name: string;
  type: string;
  values?: string[];
  maxSelect?: number;
}
