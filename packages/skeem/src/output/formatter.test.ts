import { describe, expect, test } from "vitest";

import { NotFoundError } from "../errors/index.js";
import { ENVELOPE_VERSION, toErrorEnvelope, toSuccessEnvelope } from "./formatter.js";

describe("envelope version", () => {
  test("success envelopes carry v:1", () => {
    const envelope = toSuccessEnvelope({ operation: "ls", data: [] });
    expect(envelope.v).toBe(1);
    expect(ENVELOPE_VERSION).toBe(1);
    expect(envelope.ok).toBe(true);
  });

  test("error envelopes carry v:1", () => {
    const skem = toErrorEnvelope(new NotFoundError("widgets", "9"), "get", "widgets");
    expect(skem.v).toBe(1);
    expect(skem.ok).toBe(false);
    expect(skem.error.code).toBe("NOT_FOUND");

    const generic = toErrorEnvelope(new Error("boom"), "create");
    expect(generic.v).toBe(1);
    expect(generic.error.code).toBe("ERROR");

    const nonError = toErrorEnvelope("plain string", "find");
    expect(nonError.v).toBe(1);
  });
});
