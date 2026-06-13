import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

describe("loadConfig adapter-default URLs", () => {
  let rootDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "skeem-config-"));
    // Hermetic: a stray SKEEM_* in the environment would override the config.
    for (const key of ["SKEEM_ADAPTER", "SKEEM_URL", "SKEEM_TOKEN", "SKEEM_ACTOR", "SKEEM_PROFILE"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(rootDir, { recursive: true, force: true });
  });

  async function writeConfig(yaml: string): Promise<void> {
    await writeFile(path.join(rootDir, ".skeemrc.yaml"), yaml, "utf8");
  }

  test("a reference adapter resolves its default URL when none is configured", async () => {
    await writeConfig("adapter: wikidata\n");
    const config = await loadConfig(rootDir, baseCli);
    expect(config.adapter).toBe("wikidata");
    expect(config.connection.url).toBe("https://www.wikidata.org");
  });

  test("--adapter on the CLI also picks up the default URL", async () => {
    // No config file at all — adapter comes from the CLI flag.
    const config = await loadConfig(rootDir, { ...baseCli, adapter: "crossref" });
    expect(config.connection.url).toBe("https://api.crossref.org");
  });

  test("an explicit URL wins over the adapter default", async () => {
    await writeConfig("adapter: wikidata\nconnection:\n  url: https://wikidata.example\n");
    const config = await loadConfig(rootDir, baseCli);
    expect(config.connection.url).toBe("https://wikidata.example");
  });

  test("a --url flag wins over the adapter default", async () => {
    await writeConfig("adapter: tmdb\n");
    const config = await loadConfig(rootDir, { ...baseCli, url: "https://tmdb.example" });
    expect(config.connection.url).toBe("https://tmdb.example");
  });

  test("a writable backend with no URL still throws", async () => {
    await writeConfig("adapter: directus\n");
    await expect(loadConfig(rootDir, baseCli)).rejects.toThrow(/Missing connection URL/);
  });
});
