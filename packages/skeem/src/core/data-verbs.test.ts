import { describe, expect, test } from "vitest";

import { AmbiguousError, UsageError, ValidationError } from "../errors/index.js";
import {
  buildLinkMutationPlan,
  buildUnlinkMutationPlan,
  mergeUpsertCreateNode,
  parseExecLinkOperation,
  parseLinkArguments,
  parseRecordReference,
  resolveUpsertDecision,
} from "./data-verbs.js";
import type { Collection, InputNode, Relation } from "../types/index.js";

const companiesCollection: Collection = {
  name: "companies",
  primaryKey: "id",
  fields: new Map(),
  relations: [],
  uniqueConstraints: [],
};

describe("resolveUpsertDecision", () => {
  test("returns create when no matches exist", () => {
    expect(resolveUpsertDecision(companiesCollection, { name: "Acme" }, [])).toEqual({ kind: "create" });
  });

  test("returns update when one match exists", () => {
    const decision = resolveUpsertDecision(companiesCollection, { name: "Acme" }, [{ id: 42, name: "Acme" }]);
    expect(decision.kind).toBe("update");
    if (decision.kind !== "update") {
      throw new Error("Expected update decision.");
    }
    expect(decision.record).toEqual({ id: 42, name: "Acme" });
  });

  test("throws on ambiguous matches", () => {
    expect(() => resolveUpsertDecision(companiesCollection, { name: "Acme" }, [{ id: 1 }, { id: 2 }]))
      .toThrowError(AmbiguousError);
  });
});

describe("mergeUpsertCreateNode", () => {
  test("merges match fields into create payloads", () => {
    const node: InputNode = {
      fields: { industry: "Technology" },
      children: {
        address: {
          fields: { city: "Chicago" },
          children: {},
        },
      },
    };

    expect(mergeUpsertCreateNode(node, { name: "Acme" }, "companies")).toEqual({
      fields: {
        industry: "Technology",
        name: "Acme",
      },
      children: node.children,
    });
  });

  test("rejects conflicting explicit field values", () => {
    expect(() => mergeUpsertCreateNode({
      fields: { name: "Other Co" },
      children: {},
    }, { name: "Acme" }, "companies")).toThrowError(ValidationError);
  });

  test("rejects match fields that collide with nested relation input", () => {
    expect(() => mergeUpsertCreateNode({
      fields: {},
      children: {
        company: {
          fields: { name: "Acme" },
          children: {},
        },
      },
    }, { company: 42 }, "people")).toThrowError(UsageError);
  });
});

describe("link parsing and planning", () => {
  const m2oRelation: Relation = {
    type: "m2o",
    field: "company_id",
    relatedCollection: "companies",
    relatedField: "id",
  };

  const m2mRelation: Relation = {
    type: "m2m",
    field: "labels",
    relatedCollection: "labels",
    relatedField: "widgets",
    junctionCollection: "labels_widgets",
    junctionLocalField: "widgets_id",
    junctionForeignField: "labels_id",
  };

  test("parses record references and inferred relation targets", () => {
    expect(parseRecordReference("widgets:17", "source")).toEqual({
      collectionInput: "widgets",
      id: 17,
    });

    expect(parseLinkArguments("labels:3")).toEqual({
      relationInput: "labels",
      target: {
        kind: "record",
        collectionInput: "labels",
        id: 3,
      },
    });
  });

  test("requires an explicit relation for bare ids and filter targets", () => {
    expect(() => parseLinkArguments("3")).toThrowError(UsageError);
    expect(() => parseLinkArguments("?name=urgent")).toThrowError(UsageError);
  });

  test("parses explicit exec link target objects", () => {
    expect(parseExecLinkOperation({
      target: {
        id: 42,
        collection: "companies",
      },
    })).toEqual({
      relationInput: "companies",
      target: {
        kind: "record",
        id: 42,
        collectionInput: "companies",
      },
    });

    expect(parseExecLinkOperation({
      relation: "company",
      target: {
        filter: {
          name: "Acme",
        },
      },
    })).toEqual({
      relationInput: "company",
      target: {
        kind: "resolve",
        filter: {
          name: "Acme",
        },
      },
    });
  });

  test("rejects malformed exec link targets", () => {
    expect(() => parseExecLinkOperation({
      target: {
        id: 42,
        filter: { name: "Acme" },
      },
    })).toThrowError(UsageError);

    expect(() => parseExecLinkOperation({
      relation: "company",
    })).toThrowError(UsageError);
  });

  test("plans m2o link updates", () => {
    expect(buildLinkMutationPlan(m2oRelation, 7, 42)).toEqual({
      kind: "m2o",
      update: {
        field: "company_id",
        value: 42,
      },
    });
  });

  test("plans m2m link and unlink junction operations", () => {
    expect(buildLinkMutationPlan(m2mRelation, 7, 42)).toEqual({
      kind: "m2m",
      junction: {
        collection: "labels_widgets",
        data: {
          widgets_id: 7,
          labels_id: 42,
        },
        filter: {
          widgets_id: 7,
          labels_id: 42,
        },
      },
    });

    expect(buildUnlinkMutationPlan(m2mRelation, 7, 42)).toEqual({
      kind: "m2m",
      junction: {
        collection: "labels_widgets",
        data: {
          widgets_id: 7,
          labels_id: 42,
        },
        filter: {
          widgets_id: 7,
          labels_id: 42,
        },
      },
    });
  });
});
