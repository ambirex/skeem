import { describe, expect, test } from "vitest";

import { parseServerArgs } from "./args.js";

describe("parseServerArgs", () => {
  test("maps connection flags into baseCli", () => {
    const args = parseServerArgs([
      "--adapter", "directus",
      "--url", "http://localhost:8055",
      "--token", "tok",
      "--profile", "prod",
      "--actor", "agent-a",
      "--cwd", "/work",
    ]);
    expect(args.cwd).toBe("/work");
    expect(args.readOnly).toBe(false);
    expect(args.baseCli).toMatchObject({
      adapter: "directus",
      url: "http://localhost:8055",
      token: "tok",
      profile: "prod",
      actor: "agent-a",
      json: true,
      yes: true,
      dryRun: false,
    });
  });

  test("accepts --flag=value form", () => {
    const args = parseServerArgs(["--adapter=wikidata", "--cwd=/tmp/x"]);
    expect(args.baseCli.adapter).toBe("wikidata");
    expect(args.cwd).toBe("/tmp/x");
  });

  test("--read-only sets the flag", () => {
    expect(parseServerArgs(["--read-only"]).readOnly).toBe(true);
  });

  test("defaults cwd to process.cwd()", () => {
    expect(parseServerArgs([]).cwd).toBe(process.cwd());
  });

  test("rejects an unknown flag", () => {
    expect(() => parseServerArgs(["--nope", "x"])).toThrowError(/Unknown argument/);
  });

  test("rejects a value flag with no value", () => {
    expect(() => parseServerArgs(["--adapter"])).toThrowError(/Missing value/);
  });
});
