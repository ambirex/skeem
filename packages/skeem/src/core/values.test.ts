import { describe, expect, test } from "vitest";

import { buildInputNode, parseScalar, resolveRefs, topoSortOperations } from "./values.js";
import type { Collection, Field, FieldType } from "../types/index.js";

function field(name: string, type: FieldType): Field {
  return { name, type, required: false, unique: false };
}

function collection(name: string, fields: Record<string, FieldType>): Collection {
  return {
    name,
    primaryKey: "id",
    fields: new Map(Object.entries(fields).map(([n, t]) => [n, field(n, t)])),
    relations: [],
    uniqueConstraints: [],
  };
}

describe("buildInputNode", () => {
  test("builds nested relation inputs and selectors", () => {
    const node = buildInputNode(
      [
        ["name", "Jane"],
        ["company", "??name=Acme"],
        ["company.industry", "Technology"],
        ["company.address.city", "Chicago"],
      ],
      collection("people", { name: "string" }),
    );

    expect(node.fields.name).toBe("Jane");
    expect(node.children.company?.selector).toEqual({
      kind: "resolveOrCreate",
      filter: { name: "Acme" },
    });
    expect(node.children.company?.fields.industry).toBe("Technology");
    expect(node.children.company?.children.address?.fields.city).toBe("Chicago");
  });

  test("a numeric-looking value in a string field stays a string (the ISBN guard)", () => {
    const node = buildInputNode([["isbn_13", "9780345391803"]], collection("books", { isbn_13: "string" }));
    expect(node.fields.isbn_13).toBe("9780345391803");
  });

  test("declared integer/float fields still coerce", () => {
    const node = buildInputNode(
      [["qty", "2"], ["price", "19.99"]],
      collection("order_lines", { qty: "integer", price: "float" }),
    );
    expect(node.fields.qty).toBe(2);
    expect(node.fields.price).toBe(19.99);
  });

  test("a field absent from the schema falls back to the heuristic", () => {
    const node = buildInputNode([["mystery", "42"]], collection("things", {}));
    expect(node.fields.mystery).toBe(42);
  });
});

describe("parseScalar", () => {
  test("schema-directed: string fields keep numeric/boolean-looking strings", () => {
    expect(parseScalar("9780345391803", "string")).toBe("9780345391803");
    expect(parseScalar("true", "string")).toBe("true");
    expect(parseScalar("42", "text")).toBe("42");
    expect(parseScalar("null", "string")).toBeNull(); // null stays the unset sentinel
  });

  test("schema-directed: numeric/boolean fields coerce", () => {
    expect(parseScalar("42", "integer")).toBe(42);
    expect(parseScalar("19.99", "float")).toBe(19.99);
    expect(parseScalar("true", "boolean")).toBe(true);
    expect(parseScalar("false", "boolean")).toBe(false);
    expect(parseScalar("notanumber", "integer")).toBe("notanumber"); // backend validates
  });

  test("no field type → heuristic (back-compat)", () => {
    expect(parseScalar("42")).toBe(42);
    expect(parseScalar("19.99")).toBe(19.99);
    expect(parseScalar("true")).toBe(true);
    expect(parseScalar("null")).toBeNull();
    expect(parseScalar("hello")).toBe("hello");
  });

  test("explicit type prefixes override schema and heuristic", () => {
    expect(parseScalar("str:9780345391803")).toBe("9780345391803");
    expect(parseScalar("str:9780345391803", "integer")).toBe("9780345391803"); // prefix wins
    expect(parseScalar("int:42", "string")).toBe(42); // prefix wins
    expect(parseScalar("float:19.99")).toBe(19.99);
    expect(parseScalar("bool:true")).toBe(true);
    expect(parseScalar("json:{\"a\":1}")).toEqual({ a: 1 });
    expect(parseScalar("json:[1,2]")).toEqual([1, 2]);
  });

  test("str: escapes the relation prefixes and literal tokens", () => {
    expect(parseScalar("str:@42")).toBe("@42");
    expect(parseScalar("str:null")).toBe("null");
    expect(parseScalar("str:int:5")).toBe("int:5");
  });

  test("unrecognized tags pass through untouched", () => {
    expect(parseScalar("https://example.com")).toBe("https://example.com");
    expect(parseScalar("note: hi", "string")).toBe("note: hi");
  });

  test("malformed typed literals error clearly", () => {
    expect(() => parseScalar("int:nope")).toThrowError(/int: expects an integer/);
    expect(() => parseScalar("float:x")).toThrowError(/float: expects a number/);
    expect(() => parseScalar("bool:maybe")).toThrowError(/bool: expects true or false/);
    expect(() => parseScalar("json:{bad")).toThrowError(/json: expects valid JSON/);
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
