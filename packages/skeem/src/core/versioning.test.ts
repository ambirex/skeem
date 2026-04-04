import { describe, expect, test } from "vitest";

import { buildVersionRecord, diffChangedFields } from "./versioning.js";

describe("versioning helpers", () => {
  test("detects shallow and nested changed fields", () => {
    expect(diffChangedFields(
      {
        id: 1,
        name: "Acme",
        settings: {
          color: "red",
          enabled: true,
        },
        tags: ["a"],
      },
      {
        id: 1,
        name: "Acme, Inc.",
        settings: {
          color: "blue",
          enabled: true,
        },
        tags: ["a", "b"],
      },
    )).toEqual(["name", "settings", "tags"]);
  });

  test("builds a version record with provenance linkage", () => {
    expect(buildVersionRecord({
      collection: "companies",
      recordId: 42,
      version: 2,
      snapshot: {
        id: 42,
        name: "Acme",
        industry: "Seed",
      },
      changedFields: ["industry"],
      provenanceId: 7,
      createdAt: "2026-04-04T00:00:00.000Z",
    })).toEqual({
      collection: "companies",
      record_id: "42",
      version: 2,
      snapshot: {
        id: 42,
        name: "Acme",
        industry: "Seed",
      },
      changed_fields: ["industry"],
      provenance_id: 7,
      created_at: "2026-04-04T00:00:00.000Z",
    });
  });
});
