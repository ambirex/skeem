import { describe, expect, test } from "vitest";

import { describeCollection, deserializeSchema, schemaToDocument, serializeSchema } from "./serialization.js";
import type { Schema } from "../types/index.js";

function makeSchema(): Schema {
  return {
    collections: new Map([
      [
        "companies",
        {
          name: "companies",
          primaryKey: "id",
          fields: new Map([
            ["id", { name: "id", type: "integer", required: false, unique: true }],
            ["name", { name: "name", type: "string", required: true, unique: true }],
          ]),
          relations: [],
          uniqueConstraints: [{ fields: ["name"] }],
        },
      ],
      [
        "people",
        {
          name: "people",
          primaryKey: "id",
          fields: new Map([
            ["id", { name: "id", type: "integer", required: false, unique: true }],
            ["name", { name: "name", type: "string", required: true, unique: false }],
            ["company_id", { name: "company_id", type: "integer", required: false, unique: false }],
          ]),
          relations: [
            {
              type: "m2o",
              field: "company_id",
              relatedCollection: "companies",
              relatedField: "id",
            },
          ],
          uniqueConstraints: [{ fields: ["name", "company_id"] }],
        },
      ],
    ]),
  };
}

describe("serializeSchema", () => {
  test("round-trips a schema through cache serialization", () => {
    const schema = makeSchema();
    const serialized = serializeSchema(schema);
    const deserialized = deserializeSchema(serialized);

    expect(Array.from(deserialized.collections.keys())).toEqual(["companies", "people"]);
    expect(deserialized.collections.get("people")?.relations).toEqual(schema.collections.get("people")?.relations);
  });
});

describe("schemaToDocument", () => {
  test("converts a schema to declarative discovery output", () => {
    const document = schemaToDocument(makeSchema(), {
      name: "example-schema",
      collections: ["people", "companies"],
    });

    expect(document.name).toBe("example-schema");
    expect(document.collections.people?.fields.name?.type).toBe("string");
    expect(document.collections.people?.relations?.company_id).toEqual({
      collection: "companies",
      type: "m2o",
    });
    expect(document.collections.people?.uniqueConstraints).toEqual([["company_id", "name"]]);
    expect(document.collections.people?.fields.id).toBeUndefined();
  });
});

describe("describeCollection", () => {
  test("produces a sorted describe document", () => {
    const description = describeCollection(makeSchema().collections.get("people")!);

    expect(description.primaryKey).toBe("id");
    expect(description.fields.map((field) => field.name)).toEqual(["company_id", "id", "name"]);
    expect(description.relations[0]?.field).toBe("company_id");
  });
});
