import { describe, expect, test } from "vitest";

import { buildSystemCollectionStatus, getSystemCollectionDefinition, listSupportedSystemCollections } from "./tables.js";
import type { Schema } from "../types/index.js";

describe("system tables", () => {
  test("lists supported system collections", () => {
    const definitions = listSupportedSystemCollections();

    expect(definitions.map((definition) => definition.name)).toEqual([
      "skeem_aliases",
      "skeem_provenance",
      "skeem_versions",
      "skeem_trash",
      "skeem_claims",
      "skeem_annotations",
    ]);
    expect(definitions[0]?.fields.map((field) => field.name)).toEqual([
      "collection",
      "record_id",
      "alias",
      "alias_normalized",
      "created_by",
      "created_at",
    ]);
    expect(definitions[1]?.fields.map((field) => field.name)).toEqual([
      "collection",
      "record_id",
      "operation",
      "actor",
      "actor_type",
      "context",
      "input_refs",
      "idempotency_key",
      "created_at",
    ]);
    expect(definitions[2]?.fields.map((field) => field.name)).toEqual([
      "collection",
      "record_id",
      "version",
      "snapshot",
      "changed_fields",
      "provenance_id",
      "created_at",
    ]);
    expect(definitions[3]?.fields.map((field) => field.name)).toEqual([
      "collection",
      "record_id",
      "snapshot",
      "deleted_by",
      "provenance_id",
      "deleted_at",
      "expires_at",
    ]);
    expect(definitions[4]?.fields.map((field) => field.name)).toEqual([
      "collection",
      "record_id",
      "claimed_by",
      "purpose",
      "lease_until",
      "created_at",
    ]);
    expect(definitions[5]?.fields.map((field) => field.name)).toEqual([
      "collection",
      "record_id",
      "key",
      "value",
      "actor",
      "created_at",
      "expires_at",
    ]);
  });

  test("builds status from live schema presence", () => {
    const schema: Schema = {
      collections: new Map([
        ["skeem_aliases", {
          name: "skeem_aliases",
          primaryKey: "id",
          fields: new Map(),
          relations: [],
          uniqueConstraints: [],
        }],
      ]),
    };

    expect(buildSystemCollectionStatus(schema)).toEqual([
      expect.objectContaining({
        collection: "skeem_aliases",
        exists: true,
        supported: true,
      }),
      expect.objectContaining({
        collection: "skeem_provenance",
        exists: false,
        supported: true,
      }),
      expect.objectContaining({
        collection: "skeem_versions",
        exists: false,
        supported: true,
      }),
      expect.objectContaining({
        collection: "skeem_trash",
        exists: false,
        supported: true,
      }),
      expect.objectContaining({
        collection: "skeem_claims",
        exists: false,
        supported: true,
      }),
      expect.objectContaining({
        collection: "skeem_annotations",
        exists: false,
        supported: true,
      }),
    ]);
  });

  test("looks up individual definitions", () => {
    expect(getSystemCollectionDefinition("skeem_aliases")?.purpose).toContain("Shared alias lookup");
    expect(getSystemCollectionDefinition("skeem_provenance")?.purpose).toContain("provenance");
    expect(getSystemCollectionDefinition("skeem_versions")?.purpose).toContain("Version history");
    expect(getSystemCollectionDefinition("skeem_trash")?.purpose).toContain("Soft-delete");
    expect(getSystemCollectionDefinition("skeem_claims")?.purpose).toContain("coordination");
    expect(getSystemCollectionDefinition("skeem_annotations")?.purpose).toContain("metadata");
    expect(getSystemCollectionDefinition("missing")).toBeUndefined();
  });
});
