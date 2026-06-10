import { describe, expect, test } from "vitest";

import { buildDefinePlan } from "./plan.js";
import type { SchemaDocument } from "./serialization.js";

describe("buildDefinePlan", () => {
  test("orders additive schema actions before destructive ones", () => {
    const liveDocument: SchemaDocument = {
      name: "live",
      collections: {
        widgets: {
          fields: {
            name: { type: "string" },
          },
        },
      },
    };

    const fileDocument: SchemaDocument = {
      name: "file",
      collections: {
        labels: {
          fields: {
            name: { type: "string", required: true, unique: true },
          },
        },
        projects: {
          fields: {
            code: { type: "string", unique: true },
            name: { type: "string", required: true },
          },
        },
        widgets: {
          fields: {
            description: { type: "text" },
            name: { type: "string" },
            project_id: { type: "integer" },
          },
          relations: {
            project_id: {
              collection: "projects",
              type: "m2o",
            },
            labels: {
              collection: "labels",
              type: "m2m",
            },
          },
        },
      },
    };

    const result = buildDefinePlan(fileDocument, liveDocument);

    expect(result.plan.map((entry) => entry.action)).toEqual([
      "create_collection",
      "create_collection",
      "create_field",
      "create_field",
      "create_relation",
      "create_many_to_many_relation",
    ]);
    expect(result.summary.executable).toBe(6);
    expect(result.summary.blocked).toBe(0);
  });

  test("marks destructive removals executable and keeps unsupported unique constraints blocked", () => {
    const liveDocument: SchemaDocument = {
      name: "live",
      collections: {
        labels: {
          fields: {
            name: { type: "string", required: true, unique: true },
          },
        },
        widgets: {
          fields: {
            name: { type: "string", unique: true },
            legacy: { type: "string" },
          },
          relations: {
            owner_id: {
              collection: "people",
              type: "m2o",
            },
            tags: {
              collection: "tags",
              type: "m2m",
            },
          },
          uniqueConstraints: [["legacy", "name"]],
        },
      },
    };

    const fileDocument: SchemaDocument = {
      name: "file",
      collections: {
        widgets: {
          fields: {
            name: { type: "string" },
          },
        },
      },
    };

    const result = buildDefinePlan(fileDocument, liveDocument);

    expect(result.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "remove_field",
        collection: "widgets",
        field: "legacy",
        executable: true,
        destructive: true,
      }),
      expect.objectContaining({
        action: "update_field",
        collection: "widgets",
        field: "name",
        executable: true,
      }),
      expect.objectContaining({
        action: "remove_relation",
        collection: "widgets",
        field: "owner_id",
        executable: true,
        destructive: true,
      }),
      expect.objectContaining({
        action: "remove_unique_constraint",
        collection: "widgets",
        executable: false,
        destructive: true,
      }),
      expect.objectContaining({
        action: "remove_many_to_many_relation",
        summary: "remove junction: widgets.tags <-> tags",
        executable: true,
        destructive: true,
      }),
      expect.objectContaining({
        action: "remove_collection",
        collection: "labels",
        executable: true,
        destructive: true,
      }),
    ]));
    expect(result.summary.blocked).toBe(1);
  });

  test("emits a from/to pair for an m2o relation change", () => {
    const liveDocument: SchemaDocument = {
      name: "live",
      collections: {
        people: {
          fields: { company_id: { type: "integer" } },
          relations: { company_id: { collection: "companies", type: "m2o" } },
        },
      },
    };

    const fileDocument: SchemaDocument = {
      name: "file",
      collections: {
        people: {
          fields: { company_id: { type: "integer" } },
          relations: { company_id: { collection: "orgs", type: "m2o" } },
        },
      },
    };

    const result = buildDefinePlan(fileDocument, liveDocument);
    const update = result.plan.find((entry) => entry.action === "update_relation");

    expect(update?.executable).toBe(true);
    expect(update?.details?.relation).toEqual({
      from: { collection: "people", field: "company_id", relatedCollection: "companies", type: "m2o" },
      to: { collection: "people", field: "company_id", relatedCollection: "orgs", type: "m2o" },
    });
  });

  test("collapses both sides of an m2m into a single junction entry", () => {
    const liveDocument: SchemaDocument = { name: "live", collections: {} };
    const fileDocument: SchemaDocument = {
      name: "file",
      collections: {
        people: {
          fields: { id: { type: "integer" } },
          relations: { tags: { collection: "tags", type: "m2m" } },
        },
        tags: {
          fields: { id: { type: "integer" } },
          relations: { people: { collection: "people", type: "m2m" } },
        },
      },
    };

    const result = buildDefinePlan(fileDocument, liveDocument);
    const junctions = result.plan.filter((entry) => entry.action === "create_many_to_many_relation");

    expect(junctions).toHaveLength(1);
    expect(junctions[0]?.details?.relation).toMatchObject({
      type: "m2m",
      junctionCollection: "people_tags",
    });
  });

  test("marks enum choice changes as an executable field update", () => {
    const liveDocument: SchemaDocument = {
      name: "live",
      collections: {
        articles: {
          fields: { status: { type: "string", enum: ["draft", "published"] } },
        },
      },
    };

    const fileDocument: SchemaDocument = {
      name: "file",
      collections: {
        articles: {
          fields: { status: { type: "string", enum: ["draft", "published", "archived"] } },
        },
      },
    };

    const result = buildDefinePlan(fileDocument, liveDocument);
    const update = result.plan.find((entry) => entry.action === "update_field");

    expect(update?.executable).toBe(true);
    expect((update?.details?.field as { enum?: string[] })?.enum).toEqual(["draft", "published", "archived"]);
  });

  test("blocks m2m structural changes", () => {
    const liveDocument: SchemaDocument = {
      name: "live",
      collections: {
        people: {
          fields: { id: { type: "integer" } },
          relations: { tags: { collection: "tags", type: "m2m", junctionCollection: "old_jt" } },
        },
      },
    };

    const fileDocument: SchemaDocument = {
      name: "file",
      collections: {
        people: {
          fields: { id: { type: "integer" } },
          relations: { tags: { collection: "tags", type: "m2m", junctionCollection: "new_jt" } },
        },
      },
    };

    const result = buildDefinePlan(fileDocument, liveDocument);
    const update = result.plan.find((entry) => entry.action === "update_relation");

    expect(update?.executable).toBe(false);
    expect(update?.reason).toMatch(/many-to-many/i);
  });
});
