import { afterEach, describe, expect, test } from "vitest";

import { createStrapiAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const companyCT = {
  uid: "api::company.company",
  apiID: "company",
  schema: {
    kind: "collectionType",
    singularName: "company",
    pluralName: "companies",
    attributes: {
      name: { type: "string", required: true, unique: true },
      industry: { type: "string" },
      status: { type: "enumeration", enum: ["active", "archived"] },
      blocks: { type: "dynamiczone" },
    },
  },
};

const personCT = {
  uid: "api::person.person",
  apiID: "person",
  schema: {
    kind: "collectionType",
    singularName: "person",
    pluralName: "people",
    attributes: {
      name: { type: "string" },
      company: { type: "relation", relation: "manyToOne", target: "api::company.company" },
    },
  },
};

/** Route admin login + content-type-builder for introspection tests. */
function mockIntrospect() {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/admin/login") && init?.method === "POST") {
      return json({ data: { token: "admin-jwt" } });
    }
    if (u.includes("/content-type-builder/content-types")) {
      return json({ data: [companyCT, personCT] });
    }
    return json({ data: [] });
  }) as unknown as typeof fetch;
}

describe("createStrapiAdapter", () => {
  test("exposes the data-tier surface and omits schema mutation", () => {
    const adapter = createStrapiAdapter();
    expect(adapter.name).toBe("strapi");
    for (const method of ["connect", "introspect", "get", "find", "create", "update", "delete", "count"] as const) {
      expect(typeof adapter[method]).toBe("function");
    }
    // Data tier: no schema mutation, so define/init fail with capability errors.
    expect(adapter.createCollection).toBeUndefined();
    expect(adapter.createField).toBeUndefined();
    expect(adapter.createRelation).toBeUndefined();
    expect(adapter.deleteCollection).toBeUndefined();
  });

  test("introspect maps attributes, enum, and the manyToOne relation; PK is 'id'", async () => {
    mockIntrospect();
    const adapter = createStrapiAdapter();
    await adapter.connect({ url: "http://strapi.test", token: "api", email: "a@b.c", password: "pw" });
    const schema = await adapter.introspect();

    const companies = schema.collections.get("companies")!;
    expect(companies.primaryKey).toBe("id");
    expect(companies.fields.get("name")?.required).toBe(true);
    expect(companies.fields.get("name")?.unique).toBe(true);
    expect(companies.fields.get("status")?.enum).toEqual(["active", "archived"]);
    expect(companies.fields.has("blocks")).toBe(false); // dynamiczone skipped

    const people = schema.collections.get("people")!;
    expect(people.relations).toEqual([
      { type: "m2o", field: "company", relatedCollection: "companies", relatedField: "id" },
    ]);
  });

  test("introspect fails clearly without admin credentials", async () => {
    const adapter = createStrapiAdapter();
    await adapter.connect({ url: "http://strapi.test", token: "api" });
    await expect(adapter.introspect()).rejects.toThrow(/admin credentials/i);
  });

  test("create posts { data } and surfaces documentId as id", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json({ data: { id: 7, documentId: "doc7", name: "Acme", industry: "Robotics" } });
    }) as unknown as typeof fetch;

    const adapter = createStrapiAdapter();
    await adapter.connect({ url: "http://strapi.test", token: "api" });
    const record = await adapter.create("companies", { name: "Acme", industry: "Robotics" });

    expect(record.id).toBe("doc7");
    expect(record.documentId).toBeUndefined();
    expect(record.name).toBe("Acme");
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toContain("/api/companies");
    expect(post?.body).toEqual({ data: { name: "Acme", industry: "Robotics" } });
  });

  test("update PUTs to the documentId path", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json({ data: { id: 7, documentId: "doc7", name: "Acme", industry: "Films" } });
    }) as unknown as typeof fetch;

    const adapter = createStrapiAdapter();
    await adapter.connect({ url: "http://strapi.test", token: "api" });
    await adapter.update("companies", "doc7", { industry: "Films" });

    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/api/companies/doc7");
    expect(put?.body).toEqual({ data: { industry: "Films" } });
  });

  test("find builds a Strapi $eq filter and maps documentId", async () => {
    const calls: Array<{ url: string }> = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push({ url: String(url) });
      return json({ data: [{ id: 7, documentId: "doc7", name: "Acme" }], meta: { pagination: { total: 1 } } });
    }) as unknown as typeof fetch;

    const adapter = createStrapiAdapter();
    await adapter.connect({ url: "http://strapi.test", token: "api" });
    const rows = await adapter.find("companies", { name: "Acme" });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("doc7");
    expect(decodeURIComponent(calls[0]!.url)).toContain("filters[name][$eq]=Acme");
  });

  test("count reads meta.pagination.total", async () => {
    globalThis.fetch = (async () =>
      json({ data: [], meta: { pagination: { total: 42 } } })
    ) as unknown as typeof fetch;

    const adapter = createStrapiAdapter();
    await adapter.connect({ url: "http://strapi.test", token: "api" });
    expect(await adapter.count!("companies")).toBe(42);
  });
});
