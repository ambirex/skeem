import { describe, expect, test } from "vitest";

import { buildTrashRecord } from "./trash.js";
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

describe("trash helpers", () => {
  test("builds a trash record with actor fallback and provenance linkage", () => {
    expect(buildTrashRecord({
      collection: "companies",
      recordId: 42,
      snapshot: {
        id: 42,
        name: "Acme",
      },
      cli: baseCli,
      config: {
        ...baseConfig,
        actor: "config-agent",
      },
      provenanceId: 7,
      deletedAt: "2026-04-04T00:00:00.000Z",
    })).toEqual({
      collection: "companies",
      record_id: "42",
      snapshot: {
        id: 42,
        name: "Acme",
      },
      deleted_by: "config-agent",
      provenance_id: 7,
      deleted_at: "2026-04-04T00:00:00.000Z",
    });
  });
});
