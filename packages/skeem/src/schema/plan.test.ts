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
          },
        },
      },
      relations: ["widgets <-> labels"],
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
          },
          uniqueConstraints: [["legacy", "name"]],
        },
      },
      relations: ["widgets <-> tags"],
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
        summary: "remove junction: widgets <-> tags",
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
});
