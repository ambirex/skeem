import { afterEach, describe, expect, test } from "vitest";

import { createNocoDbAdapter } from "./adapter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Route GETs to a fixed catalog; record every call for assertions. */
function mockCatalog(tables: Record<string, unknown>, tableList: Array<{ id: string; title: string }>) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });

    if (u.includes("/meta/bases/") && u.endsWith("/tables") && method === "GET") {
      return json({ list: tableList });
    }
    const tableMatch = /\/meta\/tables\/([^/?]+)$/.exec(u);
    if (tableMatch && method === "GET") {
      return json(tables[tableMatch[1]!]);
    }
    // Record reads (e.g. re-fetch after create/update).
    const recordRead = /\/tables\/([^/]+)\/records\/([^/?]+)/.exec(u);
    if (recordRead && method === "GET") {
      return json({ Id: Number(recordRead[2]), name: "Acme", industry: "Robotics" });
    }
    const recordCreate = /\/tables\/([^/]+)\/records/.exec(u);
    if (recordCreate && method === "POST") {
      return json({ Id: 5 });
    }
    return json({ list: [], pageInfo: { totalRows: 0 } });
  }) as unknown as typeof fetch;
  return calls;
}

const peopleTable = {
  id: "tbl_people",
  title: "people",
  columns: [
    { id: "c_pid", title: "Id", uidt: "ID", pk: true },
    { id: "c_pname", title: "name", uidt: "SingleLineText", rqd: true },
    { id: "c_created", title: "CreatedAt", uidt: "CreatedTime", system: true },
    {
      id: "c_company",
      title: "company",
      uidt: "LinkToAnotherRecord",
      colOptions: { type: "bt", fk_related_model_id: "tbl_companies" },
    },
  ],
};

const companiesTable = {
  id: "tbl_companies",
  title: "companies",
  columns: [
    { id: "c_cid", title: "Id", uidt: "ID", pk: true },
    { id: "c_cname", title: "name", uidt: "SingleLineText", rqd: true, unique: true },
    {
      id: "c_status",
      title: "status",
      uidt: "SingleSelect",
      colOptions: { options: [{ title: "active" }, { title: "archived" }] },
    },
  ],
};

const tableList = [
  { id: "tbl_people", title: "people" },
  { id: "tbl_companies", title: "companies" },
];

describe("createNocoDbAdapter", () => {
  test("exposes a named adapter surface", () => {
    const adapter = createNocoDbAdapter();
    expect(adapter.name).toBe("nocodb");
    for (const method of ["connect", "introspect", "get", "find", "create", "update", "delete", "count",
      "createCollection", "deleteCollection", "createField", "updateField", "deleteField",
      "createRelation", "updateRelation", "deleteRelation"] as const) {
      expect(typeof adapter[method]).toBe("function");
    }
  });

  test("introspect skips pk/system/link columns, maps types, and canonicalizes the PK to 'id'", async () => {
    mockCatalog({ tbl_people: peopleTable, tbl_companies: companiesTable }, tableList);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    const schema = await adapter.introspect();

    const people = schema.collections.get("people")!;
    expect(people.primaryKey).toBe("id");
    expect(people.fields.has("Id")).toBe(false);
    expect(people.fields.has("CreatedAt")).toBe(false);
    expect(people.fields.has("company")).toBe(false); // link, not a field
    expect(people.fields.get("name")?.type).toBe("string");
    expect(people.fields.get("name")?.required).toBe(true);
  });

  test("introspect reconstructs a bt link as an m2o relation", async () => {
    mockCatalog({ tbl_people: peopleTable, tbl_companies: companiesTable }, tableList);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    const schema = await adapter.introspect();

    const rel = schema.collections.get("people")!.relations;
    expect(rel).toEqual([
      { type: "m2o", field: "company", relatedCollection: "companies", relatedField: "id" },
    ]);
  });

  test("introspect maps SingleSelect to string + enum and single-column unique", async () => {
    mockCatalog({ tbl_people: peopleTable, tbl_companies: companiesTable }, tableList);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    const schema = await adapter.introspect();

    const companies = schema.collections.get("companies")!;
    expect(companies.fields.get("status")?.type).toBe("string");
    expect(companies.fields.get("status")?.enum).toEqual(["active", "archived"]);
    expect(companies.fields.get("name")?.unique).toBe(true);
    expect(companies.uniqueConstraints).toEqual([{ fields: ["name"] }]);
  });

  test("create re-reads the row and aliases the PK to 'id'", async () => {
    const calls = mockCatalog({ tbl_companies: companiesTable }, [{ id: "tbl_companies", title: "companies" }]);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    const record = await adapter.create("companies", { name: "Acme", industry: "Robotics" });

    expect(record.id).toBe(5);
    expect(record.Id).toBeUndefined();
    expect(record.name).toBe("Acme");
    // POST went to the records endpoint, then a GET re-read by the returned PK.
    expect(calls.some((c) => c.method === "POST" && c.url.includes("/tables/tbl_companies/records"))).toBe(true);
    expect(calls.some((c) => c.method === "GET" && /\/records\/5$/.test(c.url))).toBe(true);
  });

  test("update sends the PK in the body (NocoDB v2 bulk-style PATCH)", async () => {
    const calls = mockCatalog({ tbl_companies: companiesTable }, [{ id: "tbl_companies", title: "companies" }]);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    await adapter.update("companies", 5, { industry: "Robotics" });

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ Id: 5, industry: "Robotics" });
  });

  test("find builds a NocoDB equality where clause", async () => {
    const calls = mockCatalog({ tbl_companies: companiesTable }, [{ id: "tbl_companies", title: "companies" }]);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    await adapter.find("companies", { name: "Acme" });

    const list = calls.find((c) => c.method === "GET" && c.url.includes("/records") && c.url.includes("where="));
    expect(decodeURIComponent(list!.url)).toContain("where=(name,eq,Acme)");
  });

  test("createField emits a SingleSelect column with options for enum fields", async () => {
    const calls = mockCatalog({ tbl_companies: companiesTable }, [{ id: "tbl_companies", title: "companies" }]);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    await adapter.createField!("companies", { name: "stage", type: "string", enum: ["draft", "published"] });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/columns"));
    expect(post?.body?.uidt).toBe("SingleSelect");
    expect(post?.body?.colOptions?.options).toEqual([{ title: "draft" }, { title: "published" }]);
  });

  test("createCollection posts a table with mapped columns", async () => {
    const calls = mockCatalog({}, []);
    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t", base: "base1" });
    await adapter.createCollection!({
      name: "projects",
      fields: [
        { name: "code", type: "string", unique: true },
        { name: "name", type: "string", required: true },
      ],
    });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/meta/bases/base1/tables"));
    expect(post?.body?.title).toBe("projects");
    expect(post?.body?.columns).toEqual([
      { title: "code", uidt: "SingleLineText", unique: true },
      { title: "name", uidt: "SingleLineText", rqd: true },
    ]);
  });

  test("auto-discovers the base when exactly one exists and none is configured", async () => {
    const calls: Array<{ url: string }> = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      calls.push({ url: u });
      if (u.endsWith("/api/v2/meta/bases")) {
        return json({ list: [{ id: "only_base", title: "Default" }] });
      }
      if (u.includes("/meta/bases/only_base/tables")) {
        return json({ list: [] });
      }
      return json({ list: [] });
    }) as unknown as typeof fetch;

    const adapter = createNocoDbAdapter();
    await adapter.connect({ url: "http://noco.test", token: "t" });
    await adapter.introspect();

    expect(calls.some((c) => c.url.endsWith("/api/v2/meta/bases"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/meta/bases/only_base/tables"))).toBe(true);
  });
});
