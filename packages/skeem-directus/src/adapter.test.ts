import { describe, expect, test } from "vitest";

import { createDirectusAdapter } from "./adapter.js";

describe("createDirectusAdapter", () => {
  test("returns a named adapter surface", () => {
    const adapter = createDirectusAdapter();

    expect(adapter.name).toBe("directus");
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.introspect).toBe("function");
    expect(typeof adapter.create).toBe("function");
  });
});
