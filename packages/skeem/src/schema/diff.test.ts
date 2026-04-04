import { describe, expect, test } from "vitest";

import { parseSchemaDocument } from "./document.js";
import { diffSchemaDocuments } from "./diff.js";
import type { SchemaDocument } from "./serialization.js";

describe("parseSchemaDocument", () => {
  test("normalizes collections, relations, and unique constraints", () => {
    const document = parseSchemaDocument(`
name: example
collections:
  people:
    fields:
      slug:
        type: string
      company_id:
        type: integer
      name:
        type: string
        required: true
    relations:
      company_id:
        collection: companies
        type: m2o
    uniqueConstraints:
      - [slug, company_id]
      - [company_id, slug]
relations:
  - tags <-> people
`);

    expect(document.collections.people?.fields).toHaveProperty("company_id");
    expect(document.collections.people?.uniqueConstraints).toEqual([["company_id", "slug"]]);
    expect(document.relations).toEqual(["people <-> tags"]);
  });

  test("canonicalizes many-to-many relation strings regardless of order", () => {
    const document = parseSchemaDocument(`
name: example
collections:
  widgets:
    fields:
      name:
        type: string
relations:
  - widgets <-> labels
  - people <-> tags
  - labels <-> widgets
`);

    expect(document.relations).toEqual(["labels <-> widgets", "people <-> tags"]);
  });
});

describe("diffSchemaDocuments", () => {
  test("reports directional changes and collection matches", () => {
    const liveDocument: SchemaDocument = {
      name: "live",
      collections: {
        companies: {
          fields: {
            name: { type: "string", required: true, unique: true },
          },
        },
        people: {
          fields: {
            company_id: { type: "integer" },
            name: { type: "string", required: true },
          },
          relations: {
            company_id: {
              collection: "companies",
              type: "m2o",
            },
          },
        },
      },
      relations: ["people <-> tags"],
    };

    const fileDocument: SchemaDocument = {
      name: "file",
      collections: {
        people: {
          fields: {
            company_id: { type: "integer" },
            name: { type: "string", required: false },
          },
          relations: {
            company_id: {
              collection: "companies",
              type: "m2o",
            },
          },
        },
        prompts: {
          fields: {
            body: { type: "text", required: true },
          },
        },
      },
      relations: ["people <-> tags", "people <-> topics"],
    };

    const defineDiff = diffSchemaDocuments(fileDocument, liveDocument, "define");
    expect(defineDiff.matches).toEqual([]);
    expect(defineDiff.summary.totalChanges).toBe(4);
    expect(defineDiff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: "collection",
        name: "companies",
        status: "only_in_live",
        resolution: "remove_from_live",
      }),
      expect.objectContaining({
        scope: "field",
        collection: "people",
        name: "name",
        status: "mismatch",
        resolution: "update_live",
      }),
      expect.objectContaining({
        scope: "collection",
        name: "prompts",
        status: "only_in_file",
        resolution: "create_in_live",
      }),
      expect.objectContaining({
        scope: "many_to_many_relation",
        name: "people <-> topics",
        status: "only_in_file",
        resolution: "create_in_live",
      }),
    ]));

    const discoverDiff = diffSchemaDocuments(fileDocument, liveDocument, "discover");
    expect(discoverDiff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: "collection",
        name: "companies",
        resolution: "create_in_file",
      }),
      expect.objectContaining({
        scope: "field",
        collection: "people",
        name: "name",
        resolution: "update_file",
      }),
      expect.objectContaining({
        scope: "collection",
        name: "prompts",
        resolution: "remove_from_file",
      }),
    ]));
  });

  test("records exact collection matches when nothing differs", () => {
    const document: SchemaDocument = {
      name: "example",
      collections: {
        widgets: {
          fields: {
            name: { type: "string" },
          },
        },
      },
    };

    const diff = diffSchemaDocuments(document, document, "define");

    expect(diff.changes).toEqual([]);
    expect(diff.matches).toEqual(["widgets: match"]);
    expect(diff.summary.matches).toBe(1);
  });
});
