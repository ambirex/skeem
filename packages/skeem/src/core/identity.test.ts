import { describe, expect, test } from "vitest";

import { getAliasLookupCandidate, normalizeAlias } from "./identity.js";

describe("normalizeAlias", () => {
  test("lowercases, removes punctuation, and strips common suffixes", () => {
    expect(normalizeAlias("ACME Inc.")).toBe("acme");
    expect(normalizeAlias("A.C.M.E Incorporated")).toBe("acme");
    expect(normalizeAlias("Acme-Corp, LLC")).toBe("acme");
  });

  test("preserves meaningful interior whitespace", () => {
    expect(normalizeAlias("Acme   Research Lab")).toBe("acme research lab");
  });
});

describe("getAliasLookupCandidate", () => {
  test("returns single-string filters as alias candidates", () => {
    expect(getAliasLookupCandidate({ name: "Acme Inc." })).toEqual({
      field: "name",
      raw: "Acme Inc.",
      normalized: "acme",
    });
  });

  test("rejects composite and non-string filters", () => {
    expect(getAliasLookupCandidate({ name: "Acme", company_id: 42 })).toBeUndefined();
    expect(getAliasLookupCandidate({ company_id: 42 })).toBeUndefined();
  });
});
