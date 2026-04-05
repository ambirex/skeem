import { describe, expect, test } from "vitest";

import { isClaimActive, leaseUntilFromDuration, parseLeaseDuration, resolveClaimActor } from "./claims.js";
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

describe("claims helpers", () => {
  test("parses supported lease durations", () => {
    expect(parseLeaseDuration("30s")).toBe(30_000);
    expect(parseLeaseDuration("5m")).toBe(300_000);
    expect(parseLeaseDuration("2H")).toBe(7_200_000);
    expect(parseLeaseDuration("1d")).toBe(86_400_000);
    expect(parseLeaseDuration("250ms")).toBe(250);
  });

  test("rejects invalid lease durations", () => {
    expect(() => parseLeaseDuration("0m")).toThrow(/greater than zero/i);
    expect(() => parseLeaseDuration("five minutes")).toThrow(/duration/i);
    expect(() => parseLeaseDuration("15")).toThrow(/duration/i);
  });

  test("builds lease expiration timestamps", () => {
    expect(leaseUntilFromDuration(60_000, new Date("2026-04-04T12:00:00.000Z"))).toBe("2026-04-04T12:01:00.000Z");
  });

  test("filters active claims based on lease time", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    expect(isClaimActive({ lease_until: "2026-04-04T12:05:00.000Z" }, now)).toBe(true);
    expect(isClaimActive({ lease_until: "2026-04-04T11:59:59.000Z" }, now)).toBe(false);
    expect(isClaimActive({ lease_until: "not-a-date" }, now)).toBe(false);
  });

  test("requires an actor for claim operations", () => {
    expect(resolveClaimActor({ ...baseCli, actor: "assistant-1" }, baseConfig)).toBe("assistant-1");
    expect(resolveClaimActor(baseCli, { ...baseConfig, actor: "configured-agent" })).toBe("configured-agent");
    expect(() => resolveClaimActor(baseCli, baseConfig)).toThrow(/require --actor/i);
  });
});
