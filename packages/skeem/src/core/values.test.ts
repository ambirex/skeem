import { describe, expect, test } from "vitest";

import { buildInputNode, resolveRefs, topoSortOperations } from "./values.js";

describe("buildInputNode", () => {
  test("builds nested relation inputs and selectors", () => {
    const node = buildInputNode(
      [
        ["name", "Jane"],
        ["company", "??name=Acme"],
        ["company.industry", "Technology"],
        ["company.address.city", "Chicago"],
      ],
      "people",
    );

    expect(node.fields.name).toBe("Jane");
    expect(node.children.company?.selector).toEqual({
      kind: "resolveOrCreate",
      filter: { name: "Acme" },
    });
    expect(node.children.company?.fields.industry).toBe("Technology");
    expect(node.children.company?.children.address?.fields.city).toBe("Chicago");
  });
});

describe("topoSortOperations", () => {
  test("orders operations by ref dependency", () => {
    const sorted = topoSortOperations([
      {
        ref: "person",
        op: "create",
        collection: "people",
        data: { company_id: "$company.id" },
      },
      {
        ref: "company",
        op: "create",
        collection: "companies",
        data: { name: "Acme" },
      },
    ]);

    expect(sorted.map((entry) => entry.ref)).toEqual(["company", "person"]);
  });
});

describe("resolveRefs", () => {
  test("replaces ref templates in nested objects", () => {
    const resolved = resolveRefs(
      {
        data: {
          company_id: "$company.id",
          label: "unchanged",
        },
      },
      {
        company: {
          id: 42,
        },
      },
    );

    expect(resolved).toEqual({
      data: {
        company_id: 42,
        label: "unchanged",
      },
    });
  });
});
