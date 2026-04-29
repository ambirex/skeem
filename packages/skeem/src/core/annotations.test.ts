import { describe, expect, test } from "vitest";

import {
  buildAnnotationRecord,
  normalizeAnnotationKey,
  parseAnnotationValue,
  resolveAnnotationActor,
  resolveAnnotationExpiry,
} from "./annotations.js";
import type { CliGlobalOptions, ResolvedConfig } from "../types/index.js";

const baseCli: CliGlobalOptions = {
  json: true,
  noCache: false,
  refresh: false,
  dryRun: false,
  yes: false,
  verbose: false,
  noRollback: false,
  allowDestructive: false,
};

const baseConfig: ResolvedConfig = {
  adapter: "directus",
  connection: { url: "http://example.test" },
  rootDir: "/tmp/skeem",
  schema: {
    aliases: {},
    exclude: [],
  },
  extensions: {},
  sources: {},
  cache: {
    ttlMs: 60_000,
  },
};

describe("annotation helpers", () => {
  test("parses annotation values as JSON", () => {
    expect(parseAnnotationValue("0.85")).toBe(0.85);
    expect(parseAnnotationValue("\"Email bounced 2026-03-15\"")).toBe("Email bounced 2026-03-15");
    expect(parseAnnotationValue("{\"score\":0.85}")).toEqual({ score: 0.85 });
  });

  test("rejects invalid annotation JSON", () => {
    expect(() => parseAnnotationValue("Email bounced 2026-03-15")).toThrow(/valid JSON/i);
  });

  test("normalizes keys and shapes optional expiry metadata", () => {
    expect(normalizeAnnotationKey("  quality_score  ")).toBe("quality_score");
    expect(resolveAnnotationExpiry("10m", new Date("2026-04-04T12:00:00.000Z"))).toBe("2026-04-04T12:10:00.000Z");
    expect(resolveAnnotationExpiry(undefined, new Date("2026-04-04T12:00:00.000Z"))).toBeUndefined();
  });

  test("builds annotation records with actor and expiry data", () => {
    expect(buildAnnotationRecord({
      collection: "companies",
      recordId: 42,
      key: "quality_score",
      value: 0.85,
      cli: { ...baseCli, actor: "assistant-annotation" },
      config: baseConfig,
      createdAt: "2026-04-04T00:00:00.000Z",
      expiresAt: "2026-04-04T00:10:00.000Z",
    })).toEqual({
      collection: "companies",
      record_id: "42",
      key: "quality_score",
      value: 0.85,
      actor: "assistant-annotation",
      created_at: "2026-04-04T00:00:00.000Z",
      expires_at: "2026-04-04T00:10:00.000Z",
    });
  });

  test("falls back to configured actor and rejects empty keys", () => {
    expect(resolveAnnotationActor(baseCli, { ...baseConfig, actor: "configured-agent" })).toBe("configured-agent");
    expect(resolveAnnotationActor(baseCli, baseConfig)).toBeUndefined();
    expect(() => normalizeAnnotationKey("   ")).toThrow(/must not be empty/i);
  });
});
