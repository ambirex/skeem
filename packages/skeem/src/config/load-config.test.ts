import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadConfig } from "./load-config.js";
import type { CliGlobalOptions } from "../types/index.js";

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

describe("loadConfig sources section", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "skeem-config-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  test("normalizes a configured source and interpolates env vars", async () => {
    process.env.SKEEM_TEST_TMDB_KEY = "test-key-1";
    try {
      await writeFile(
        path.join(workspace, ".skeemrc.yaml"),
        [
          "adapter: directus",
          "connection:",
          "  url: http://example.test",
          "  token: example",
          "sources:",
          "  movies:",
          "    type: tmdb",
          "    api_key: \"${SKEEM_TEST_TMDB_KEY}\"",
        ].join("\n"),
      );

      const config = await loadConfig(workspace, baseCli);
      expect(config.sources.movies?.type).toBe("tmdb");
      expect(config.sources.movies?.api_key).toBe("test-key-1");
    } finally {
      delete process.env.SKEEM_TEST_TMDB_KEY;
    }
  });

  test("defaults the source type to its key when type is omitted", async () => {
    await writeFile(
      path.join(workspace, ".skeemrc.yaml"),
      [
        "adapter: directus",
        "connection:",
        "  url: http://example.test",
        "  token: example",
        "sources:",
        "  tmdb:",
        "    api_key: k1",
      ].join("\n"),
    );

    const config = await loadConfig(workspace, baseCli);
    expect(config.sources.tmdb?.type).toBe("tmdb");
  });

  test("returns empty sources when none are configured", async () => {
    await writeFile(
      path.join(workspace, ".skeemrc.yaml"),
      [
        "adapter: directus",
        "connection:",
        "  url: http://example.test",
        "  token: example",
      ].join("\n"),
    );

    const config = await loadConfig(workspace, baseCli);
    expect(config.sources).toEqual({});
  });
});
