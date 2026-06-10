import { afterEach, describe, expect, test } from "vitest";

import { createDirectusAdapter } from "./adapter.js";

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

describe("createDirectusAdapter", () => {
  test("returns a named adapter surface", () => {
    const adapter = createDirectusAdapter();

    expect(adapter.name).toBe("directus");
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

  test("createField emits a select-dropdown interface with choices for enum fields", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return jsonResponse({ data: {} });
    }) as unknown as typeof fetch;

    const adapter = createDirectusAdapter();
    await adapter.connect({ url: "http://example.test" });
    await adapter.createField!("articles", { name: "status", type: "string", enum: ["draft", "published"] });

    const post = calls.find((call) => call.url.includes("/fields/articles"));
    expect(post?.body?.type).toBe("string");
    expect(post?.body?.meta?.interface).toBe("select-dropdown");
    expect(post?.body?.meta?.options?.choices).toEqual([
      { text: "draft", value: "draft" },
      { text: "published", value: "published" },
    ]);
  });

  test("introspect reads enum choices back into field.enum", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("/fields")) {
        return jsonResponse({
          data: [
            {
              collection: "articles",
              field: "status",
              type: "string",
              meta: {
                options: {
                  choices: [
                    { text: "Draft", value: "draft" },
                    { text: "Published", value: "published" },
                  ],
                },
              },
              schema: { data_type: "string", is_nullable: true },
            },
          ],
        });
      }
      if (target.includes("/collections")) {
        return jsonResponse({ data: [{ collection: "articles" }] });
      }
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;

    const adapter = createDirectusAdapter();
    await adapter.connect({ url: "http://example.test" });
    const schema = await adapter.introspect();

    expect(schema.collections.get("articles")?.fields.get("status")?.enum).toEqual(["draft", "published"]);
  });
});
