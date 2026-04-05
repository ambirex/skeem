import { describe, expect, test } from "vitest";

import { attachIdempotencyMetadata, extractIdempotencyMetadata, idempotencyRequestsMatch } from "./idempotency.js";

describe("idempotency helpers", () => {
  test("stores and extracts replay metadata on object input refs", () => {
    const metadata = extractIdempotencyMetadata(attachIdempotencyMetadata(
      { fields: { name: "Acme" } },
      {
        operation: "create",
        collection: "companies",
        input: {
          fields: { name: "Acme" },
        },
      },
      {
        operation: "create",
        collection: "companies",
        data: { id: 42, name: "Acme" },
      },
    ));

    expect(metadata).toEqual({
      version: 1,
      request: {
        operation: "create",
        collection: "companies",
        input: {
          fields: { name: "Acme" },
        },
      },
      response: {
        operation: "create",
        collection: "companies",
        data: { id: 42, name: "Acme" },
      },
    });
  });

  test("wraps non-object input refs when storing metadata", () => {
    const metadata = extractIdempotencyMetadata(attachIdempotencyMetadata(
      "raw-value",
      {
        operation: "delete",
        collection: "widgets",
        input: {
          id: 1,
          mode: "soft",
        },
      },
      {
        operation: "delete",
        collection: "widgets",
        action: "trashed",
        data: { id: 1, trashed: true },
      },
    ));

    expect(metadata?.request.operation).toBe("delete");
    expect(metadata?.response.action).toBe("trashed");
  });

  test("matches equivalent requests regardless of object key order", () => {
    expect(idempotencyRequestsMatch(
      {
        operation: "annotate",
        collection: "companies",
        input: {
          key: "quality_score",
          value: { score: 0.85, reviewer: "assistant" },
        },
      },
      {
        operation: "annotate",
        collection: "companies",
        input: {
          value: { reviewer: "assistant", score: 0.85 },
          key: "quality_score",
        },
      },
    )).toBe(true);
  });

  test("distinguishes mismatched requests", () => {
    expect(idempotencyRequestsMatch(
      {
        operation: "create",
        collection: "companies",
        input: {
          fields: { name: "Acme" },
        },
      },
      {
        operation: "create",
        collection: "companies",
        input: {
          fields: { name: "Different Co" },
        },
      },
    )).toBe(false);
  });
});
