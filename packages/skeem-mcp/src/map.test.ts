import { describe, expect, test } from "vitest";
import { NotFoundError } from "skeem";
import type { CliGlobalOptions, SuccessEnvelope } from "skeem";

import { envelopeResult, errorResult, mergeCli, toFieldEntries, toFilter } from "./map.js";

const baseCli: CliGlobalOptions = {
  json: true,
  noCache: false,
  refresh: false,
  dryRun: false,
  yes: true,
  verbose: false,
  noRollback: false,
  allowDestructive: false,
};

describe("toFieldEntries", () => {
  test("stringifies scalars and preserves relation grammar + dotted keys", () => {
    expect(
      toFieldEntries({ name: "Acme", count: 42, active: true, missing: null, company: "??name=Acme" }),
    ).toEqual([
      ["name", "Acme"],
      ["count", "42"],
      ["active", "true"],
      ["missing", "null"],
      ["company", "??name=Acme"],
    ]);
  });

  test("undefined fields yield an empty list", () => {
    expect(toFieldEntries(undefined)).toEqual([]);
  });
});

describe("toFilter", () => {
  test("passes a scalar object through and copies it", () => {
    const where = { status: "active", n: 1 };
    const result = toFilter(where);
    expect(result).toEqual(where);
    expect(result).not.toBe(where);
  });

  test("undefined becomes an empty filter", () => {
    expect(toFilter(undefined)).toEqual({});
  });
});

describe("mergeCli", () => {
  test("defaults dryRun to false and leaves base untouched", () => {
    expect(mergeCli(baseCli)).toMatchObject({ dryRun: false });
  });

  test("threads per-call options", () => {
    const merged = mergeCli(baseCli, {
      dry_run: true,
      idempotency_key: "k1",
      actor: "agent-b",
      context: { run: "r1" },
    });
    expect(merged).toMatchObject({ dryRun: true, idempotencyKey: "k1", actor: "agent-b", context: { run: "r1" } });
  });

  test("a launch-level actor is used when the call omits one", () => {
    expect(mergeCli({ ...baseCli, actor: "launch-actor" }).actor).toBe("launch-actor");
  });
});

describe("envelopeResult", () => {
  test("carries the envelope as text and structuredContent", () => {
    const envelope: SuccessEnvelope = { v: 1, ok: true, operation: "ls", data: [] };
    const result = envelopeResult(envelope);
    expect(result.structuredContent).toEqual(envelope);
    expect(result.isError).toBeUndefined();
    const block = result.content?.[0];
    expect(block?.type).toBe("text");
    expect(JSON.parse((block as { text: string }).text)).toEqual(envelope);
  });
});

describe("errorResult", () => {
  test("maps a thrown SkemError to an ok:false envelope, not isError", () => {
    const result = errorResult(new NotFoundError("widgets", "999"), "get", "widgets");
    const envelope = result.structuredContent as { ok: boolean; error: { code: string }; operation: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("NOT_FOUND");
    expect(envelope.operation).toBe("get");
    expect(result.isError).toBeUndefined();
  });
});
