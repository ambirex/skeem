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

  test("orders upsert and relation mutations by refs inside match and target objects", () => {
    const sorted = topoSortOperations([
      {
        ref: "person_link",
        op: "link",
        collection: "people",
        id: "$person.id",
        relation: "company",
        target: {
          id: "$company.id",
          collection: "companies",
        },
      },
      {
        ref: "company_upsert",
        op: "upsert",
        collection: "companies",
        match: {
          name: "$seed.name",
        },
        data: {
          industry: "Technology",
        },
      },
      {
        ref: "seed",
        op: "create",
        collection: "companies",
        data: {
          name: "Acme",
        },
      },
      {
        ref: "person",
        op: "create",
        collection: "people",
        data: {
          name: "Jane",
        },
      },
      {
        ref: "company",
        op: "findOne",
        collection: "companies",
        filter: {
          name: "$seed.name",
        },
      },
    ]);

    const order = sorted.map((entry) => entry.ref);
    expect(order).toContain("seed");
    expect(order).toContain("company_upsert");
    expect(order).toContain("person");
    expect(order).toContain("company");
    expect(order).toContain("person_link");
    expect(order.indexOf("seed")).toBeLessThan(order.indexOf("company"));
    expect(order.indexOf("seed")).toBeLessThan(order.indexOf("company_upsert"));
    expect(order.indexOf("person")).toBeLessThan(order.indexOf("person_link"));
    expect(order.indexOf("company")).toBeLessThan(order.indexOf("person_link"));
  });

  test("fails with a helpful message for missing refs", () => {
    expect(() => topoSortOperations([
      {
        ref: "person",
        op: "create",
        collection: "people",
        data: { company_id: "$company.id" },
      },
    ])).toThrowError('Exec operation "person" references unknown ref "company".');
  });

  test("fails with a helpful message for cycles", () => {
    expect(() => topoSortOperations([
      {
        ref: "alpha",
        op: "create",
        collection: "people",
        data: { company_id: "$beta.id" },
      },
      {
        ref: "beta",
        op: "create",
        collection: "companies",
        data: { owner_id: "$alpha.id" },
      },
    ])).toThrowError('Cycle detected in exec plan: alpha -> beta -> alpha.');
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

  test("replaces nested refs in arrays and nested objects", () => {
    const resolved = resolveRefs(
      {
        updates: [
          {
            id: "$person.id",
            data: {
              company_id: "$company.id",
            },
          },
        ],
      },
      {
        person: {
          id: 7,
        },
        company: {
          id: 42,
        },
      },
    );

    expect(resolved).toEqual({
      updates: [
        {
          id: 7,
          data: {
            company_id: 42,
          },
        },
      ],
    });
  });

  test("replaces refs inside exec match and target payloads", () => {
    const resolved = resolveRefs(
      {
        match: {
          name: "$seed.name",
        },
        target: {
          id: "$company.id",
          collection: "companies",
        },
      },
      {
        seed: {
          name: "Acme",
        },
        company: {
          id: 42,
        },
      },
    );

    expect(resolved).toEqual({
      match: {
        name: "Acme",
      },
      target: {
        id: 42,
        collection: "companies",
      },
    });
  });
});
