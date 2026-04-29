import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { UsageError } from "../errors/index.js";

export interface ExtensionManifestRequires {
  skeem?: string;
  systemTables?: boolean;
}

export interface ExtensionManifest {
  name: string;
  version: string;
  description?: string;
  requires?: ExtensionManifestRequires;
  dependsOn: string[];
  cliCommands: string[];
}

export interface DiscoveredExtensionManifest {
  manifest: ExtensionManifest;
  manifestPath: string;
  rootDir: string;
}

export const MANIFEST_FILE_NAME = "skeem-extension.yaml";
export const DEFAULT_EXTENSIONS_DIR_NAME = "extensions";

export function parseExtensionManifest(contents: string, source = "extension manifest"): ExtensionManifest {
  let parsed: unknown;
  try {
    parsed = YAML.parse(contents);
  } catch (error) {
    throw new UsageError(`Failed to parse ${source} as YAML: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`Expected ${source} to be a mapping with at least name and version.`);
  }

  const raw = parsed as Record<string, unknown>;
  const name = expectNonEmptyString(raw.name, `${source} field "name"`);
  const version = expectNonEmptyString(raw.version, `${source} field "version"`);
  const description = optionalString(raw.description, `${source} field "description"`);
  const requires = parseRequires(raw.requires, source);
  const dependsOn = parseStringArray(raw.depends_on ?? raw.dependsOn, `${source} field "depends_on"`);
  const cliCommands = parseStringArray(raw.cli_commands ?? raw.cliCommands, `${source} field "cli_commands"`);

  return {
    name,
    version,
    ...(description !== undefined ? { description } : {}),
    ...(requires ? { requires } : {}),
    dependsOn,
    cliCommands,
  };
}

export async function loadExtensionManifest(manifestPath: string): Promise<ExtensionManifest> {
  const contents = await readFile(manifestPath, "utf8");
  return parseExtensionManifest(contents, manifestPath);
}

export function resolveExtensionsRoot(rootDir: string, override?: string): string {
  if (override && path.isAbsolute(override)) {
    return override;
  }
  if (override) {
    return path.resolve(rootDir, override);
  }
  return path.join(rootDir, DEFAULT_EXTENSIONS_DIR_NAME);
}

export async function discoverExtensionManifests(extensionsRoot: string): Promise<DiscoveredExtensionManifest[]> {
  const entries = await safeReadDir(extensionsRoot);
  if (entries.length === 0) {
    return [];
  }

  const discovered: DiscoveredExtensionManifest[] = [];
  for (const entry of entries) {
    const candidateDir = path.join(extensionsRoot, entry);
    const candidateStat = await safeStat(candidateDir);
    if (!candidateStat?.isDirectory()) {
      continue;
    }

    const manifestPath = path.join(candidateDir, MANIFEST_FILE_NAME);
    const manifestStat = await safeStat(manifestPath);
    if (!manifestStat?.isFile()) {
      continue;
    }

    const manifest = await loadExtensionManifest(manifestPath);
    discovered.push({ manifest, manifestPath, rootDir: candidateDir });
  }

  discovered.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
  return discovered;
}

function expectNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UsageError(`Expected ${label} to be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new UsageError(`Expected ${label} to be a string when provided.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new UsageError(`Expected ${label} to be a list of strings when provided.`);
  }
  return value.map((entry, index) => expectNonEmptyString(entry, `${label}[${index}]`));
}

function parseRequires(value: unknown, source: string): ExtensionManifestRequires | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError(`Expected ${source} field "requires" to be a mapping when provided.`);
  }
  const raw = value as Record<string, unknown>;
  const skeem = optionalString(raw.skeem, `${source} field "requires.skeem"`);
  const systemTablesRaw = raw.system_tables ?? raw.systemTables;
  if (systemTablesRaw !== undefined && typeof systemTablesRaw !== "boolean") {
    throw new UsageError(`Expected ${source} field "requires.system_tables" to be a boolean when provided.`);
  }
  const requires: ExtensionManifestRequires = {};
  if (skeem !== undefined) {
    requires.skeem = skeem;
  }
  if (typeof systemTablesRaw === "boolean") {
    requires.systemTables = systemTablesRaw;
  }
  return Object.keys(requires).length > 0 ? requires : undefined;
}

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function safeStat(target: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
