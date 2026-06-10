import { describe, expect, test } from "vitest";

import type { Collection, Field } from "../types/index.js";
import { generateToolDefinitions } from "./tools.js";

function field(name: string, overrides: Partial<Field> = {}): Field {
  return { name, type: "string", required: false, unique: false, ...overrides };
}

function peopleCollection(): Collection {
  return {
    name: "people",
    primaryKey: "id",
    fields: new Map([
      ["id", field("id")],
      ["name", field("name", { required: true })],
      ["email", field("email", { required: true, unique: true })],
      ["role", field("role")],
      ["status", field("status", { enum: ["active", "inactive"] })],
    ]),
    relations: [
      { type: "m2o", field: "company", relatedCollection: "companies", relatedField: "id" },
    ],
    uniqueConstraints: [],
  };
}

describe("generateToolDefinitions", () => {
  test("emits create/find/get/update/delete per collection (openai format)", () => {
    const tools = generateToolDefinitions([peopleCollection()], { format: "openai" });
    const names = tools.map((t: any) => t.function.name);
    expect(names).toEqual([
      "skeem_create_people",
      "skeem_find_people",
      "skeem_get_people",
      "skeem_update_people",
      "skeem_delete_people",
    ]);
    expect(tools[0]).toMatchObject({ type: "function" });
  });

  test("create tool: required fields, enum, and relation grammar", () => {
    const tools = generateToolDefinitions([peopleCollection()], { format: "openai" });
    const create = tools.find((t: any) => t.function.name === "skeem_create_people") as any;
    const params = create.function.parameters;

    expect(params.required).toEqual(["name", "email"]);
    expect(params.properties.id).toBeUndefined(); // primary key excluded
    expect(params.properties.status).toEqual({ type: "string", enum: ["active", "inactive"] });
    expect(params.properties.company.type).toEqual(["string", "integer"]);
    expect(params.properties.company.description).toContain("?field=value");
    expect(params.properties.company.description).toContain("??field=value");
    expect(create.function.description).toContain("Relations: company (m2o -> companies)");
  });

  test("anthropic format uses input_schema", () => {
    const tools = generateToolDefinitions([peopleCollection()], { format: "anthropic" });
    const create = tools.find((t: any) => t.name === "skeem_create_people") as any;
    expect(create.input_schema.type).toBe("object");
    expect((create as any).function).toBeUndefined();
    expect(create.input_schema.required).toEqual(["name", "email"]);
  });

  test("get/delete carry the id parameter; delete has a hard flag", () => {
    const tools = generateToolDefinitions([peopleCollection()], { format: "openai" });
    const get = tools.find((t: any) => t.function.name === "skeem_get_people") as any;
    const del = tools.find((t: any) => t.function.name === "skeem_delete_people") as any;
    expect(get.function.parameters.required).toEqual(["id"]);
    expect(del.function.parameters.properties.hard.type).toBe("boolean");
  });

  test("includeSchema adds discover and define tools", () => {
    const withSchema = generateToolDefinitions([peopleCollection()], { format: "openai", includeSchema: true });
    const names = withSchema.map((t: any) => t.function.name);
    expect(names).toContain("skeem_discover");
    expect(names).toContain("skeem_define");

    const without = generateToolDefinitions([peopleCollection()], { format: "openai" });
    expect(without.map((t: any) => t.function.name)).not.toContain("skeem_discover");
  });
});
