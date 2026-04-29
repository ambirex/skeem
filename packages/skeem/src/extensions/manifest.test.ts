import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test, beforeEach, afterEach } from "vitest";

import {
  DEFAULT_EXTENSIONS_DIR_NAME,
  MANIFEST_FILE_NAME,
  discoverExtensionManifests,
  parseExtensionManifest,
  resolveExtensionsRoot,
} from "./manifest.js";

describe("extension manifest parsing", () => {
  test("parses a complete manifest with snake_case fields", () => {
    const yaml = [
      "name: memory",
      "version: 0.1.0",
      "description: Agent memory system",
      "requires:",
      "  skeem: \">=0.1.0\"",
      "  system_tables: true",
      "depends_on: []",
      "cli_commands:",
      "  - remember",
      "  - recall",
      "",
    ].join("\n");

    expect(parseExtensionManifest(yaml)).toEqual({
      name: "memory",
      version: "0.1.0",
      description: "Agent memory system",
      requires: { skeem: ">=0.1.0", systemTables: true },
      dependsOn: [],
      cliCommands: ["remember", "recall"],
    });
  });

  test("accepts a minimal manifest", () => {
    const yaml = "name: kg\nversion: 0.0.1\n";
    expect(parseExtensionManifest(yaml)).toEqual({
      name: "kg",
      version: "0.0.1",
      dependsOn: [],
      cliCommands: [],
    });
  });

  test("rejects manifests missing required fields", () => {
    expect(() => parseExtensionManifest("version: 1.0.0\n")).toThrow(/non-empty string/i);
    expect(() => parseExtensionManifest("name: memory\n")).toThrow(/non-empty string/i);
    expect(() => parseExtensionManifest("name: memory\nversion: \"\"\n")).toThrow(/non-empty string/i);
  });

  test("rejects malformed YAML and non-mapping roots", () => {
    expect(() => parseExtensionManifest("name: [unterminated")).toThrow(/Failed to parse/);
    expect(() => parseExtensionManifest("- name: memory")).toThrow(/mapping/i);
  });

  test("rejects malformed list and requires shapes", () => {
    expect(() => parseExtensionManifest("name: memory\nversion: 0.1.0\ncli_commands: oops\n")).toThrow(/list of strings/i);
    expect(() => parseExtensionManifest("name: memory\nversion: 0.1.0\nrequires: oops\n")).toThrow(/mapping/i);
    expect(() => parseExtensionManifest(
      "name: memory\nversion: 0.1.0\nrequires:\n  system_tables: nope\n",
    )).toThrow(/boolean/i);
  });
});

describe("extension discovery", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = path.join(tmpdir(), `skeem-extensions-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  test("returns an empty list when the extensions root is missing", async () => {
    const root = resolveExtensionsRoot(workspace);
    expect(root.endsWith(DEFAULT_EXTENSIONS_DIR_NAME)).toBe(true);
    expect(await discoverExtensionManifests(root)).toEqual([]);
  });

  test("scans subdirectories for skeem-extension.yaml and sorts by name", async () => {
    const root = resolveExtensionsRoot(workspace);
    const memoryDir = path.join(root, "extend-memory");
    const kgDir = path.join(root, "extend-kg");
    const ignoredDir = path.join(root, "extend-broken");
    await mkdir(memoryDir, { recursive: true });
    await mkdir(kgDir, { recursive: true });
    await mkdir(ignoredDir, { recursive: true });

    await writeFile(path.join(memoryDir, MANIFEST_FILE_NAME), "name: memory\nversion: 0.1.0\n");
    await writeFile(path.join(kgDir, MANIFEST_FILE_NAME), "name: kg\nversion: 0.0.1\n");

    const manifests = await discoverExtensionManifests(root);
    expect(manifests.map((entry) => entry.manifest.name)).toEqual(["kg", "memory"]);
    expect(manifests[0]?.manifestPath).toBe(path.join(kgDir, MANIFEST_FILE_NAME));
    expect(manifests[1]?.rootDir).toBe(memoryDir);
  });

  test("respects an absolute extensions root override", async () => {
    expect(resolveExtensionsRoot(workspace, "/custom/path")).toBe("/custom/path");
    expect(resolveExtensionsRoot(workspace, "custom")).toBe(path.resolve(workspace, "custom"));
  });
});
