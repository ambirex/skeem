import { describe, expect, test } from "vitest";

import { createDirectusAdapter } from "./adapter.js";

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
});
