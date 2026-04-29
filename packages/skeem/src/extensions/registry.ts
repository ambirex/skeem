import type { DiscoveredExtensionManifest } from "./manifest.js";

export const EXTENSIONS_COLLECTION = "skeem_extensions";

export type ExtensionRegistryState =
  | "available"
  | "installed"
  | "version_drift"
  | "installed_without_manifest";

export interface InstalledExtensionRow {
  id?: string | number;
  name: string;
  version?: string;
  description?: string;
  schema_hash?: string;
  installed_by?: string;
  installed_at?: string;
}

export interface ExtensionStatusEntry {
  name: string;
  state: ExtensionRegistryState;
  manifest?: {
    version: string;
    description?: string;
    requires?: DiscoveredExtensionManifest["manifest"]["requires"];
    dependsOn: string[];
    cliCommands: string[];
    manifestPath: string;
    rootDir: string;
  };
  installed?: {
    version?: string;
    description?: string;
    schemaHash?: string;
    installedBy?: string;
    installedAt?: string;
  };
}

export interface ExtensionStatusInput {
  manifests: DiscoveredExtensionManifest[];
  installedRows: InstalledExtensionRow[];
}

export function buildExtensionStatus(input: ExtensionStatusInput): ExtensionStatusEntry[] {
  const installedByName = new Map<string, InstalledExtensionRow>();
  for (const row of input.installedRows) {
    if (row?.name) {
      installedByName.set(row.name, row);
    }
  }

  const seen = new Set<string>();
  const entries: ExtensionStatusEntry[] = [];

  for (const discovered of input.manifests) {
    const name = discovered.manifest.name;
    seen.add(name);
    const installed = installedByName.get(name);

    const entry: ExtensionStatusEntry = {
      name,
      state: !installed
        ? "available"
        : installed.version && installed.version !== discovered.manifest.version
          ? "version_drift"
          : "installed",
      manifest: {
        version: discovered.manifest.version,
        ...(discovered.manifest.description ? { description: discovered.manifest.description } : {}),
        ...(discovered.manifest.requires ? { requires: discovered.manifest.requires } : {}),
        dependsOn: [...discovered.manifest.dependsOn],
        cliCommands: [...discovered.manifest.cliCommands],
        manifestPath: discovered.manifestPath,
        rootDir: discovered.rootDir,
      },
      ...(installed
        ? { installed: shapeInstalled(installed) }
        : {}),
    };

    entries.push(entry);
  }

  for (const row of input.installedRows) {
    if (!row?.name || seen.has(row.name)) {
      continue;
    }
    entries.push({
      name: row.name,
      state: "installed_without_manifest",
      installed: shapeInstalled(row),
    });
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  return entries;
}

export function summarizeExtensionStatus(entries: ExtensionStatusEntry[]): {
  total: number;
  available: number;
  installed: number;
  versionDrift: number;
  installedWithoutManifest: number;
} {
  const summary = {
    total: entries.length,
    available: 0,
    installed: 0,
    versionDrift: 0,
    installedWithoutManifest: 0,
  };
  for (const entry of entries) {
    if (entry.state === "available") summary.available += 1;
    else if (entry.state === "installed") summary.installed += 1;
    else if (entry.state === "version_drift") summary.versionDrift += 1;
    else summary.installedWithoutManifest += 1;
  }
  return summary;
}

function shapeInstalled(row: InstalledExtensionRow): NonNullable<ExtensionStatusEntry["installed"]> {
  return {
    ...(row.version ? { version: row.version } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.schema_hash ? { schemaHash: row.schema_hash } : {}),
    ...(row.installed_by ? { installedBy: row.installed_by } : {}),
    ...(row.installed_at ? { installedAt: row.installed_at } : {}),
  };
}
