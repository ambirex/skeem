import { describe, expect, test } from "vitest";

import { buildProvenanceRecord, resolveProvenanceActor } from "./provenance.js";
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
  cache: {
    ttlMs: 60_000,
  },
};

describe("provenance helpers", () => {
  test("prefers cli actor over config actor", () => {
    expect(resolveProvenanceActor(
      { ...baseCli, actor: "cli-agent" },
      { ...baseConfig, actor: "config-agent" },
    )).toBe("cli-agent");
  });

  test("falls back to config actor and then skeem", () => {
    expect(resolveProvenanceActor(baseCli, { ...baseConfig, actor: "config-agent" })).toBe("config-agent");
    expect(resolveProvenanceActor(baseCli, baseConfig)).toBe("skeem");
  });

  test("builds a provenance record with context and idempotency data", () => {
    expect(buildProvenanceRecord({
      collection: "companies",
      recordId: 42,
      operation: "update",
      cli: {
        ...baseCli,
        actor: "assistant-1",
        context: { task: "onboarding" },
        idempotencyKey: "job-42",
      },
      config: baseConfig,
      createdAt: "2026-04-04T00:00:00.000Z",
      inputRefs: {
        id: 42,
        fields: {
          name: "Acme",
        },
      },
    })).toEqual({
      collection: "companies",
      record_id: "42",
      operation: "update",
      actor: "assistant-1",
      actor_type: "agent",
      context: { task: "onboarding" },
      input_refs: {
        id: 42,
        fields: {
          name: "Acme",
        },
      },
      idempotency_key: "job-42",
      created_at: "2026-04-04T00:00:00.000Z",
    });
  });
});
