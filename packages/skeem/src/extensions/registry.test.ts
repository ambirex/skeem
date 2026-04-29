import { describe, expect, test } from "vitest";

import { buildExtensionStatus, summarizeExtensionStatus } from "./registry.js";
import type { DiscoveredExtensionManifest } from "./manifest.js";

function manifest(name: string, version: string, overrides: Partial<DiscoveredExtensionManifest["manifest"]> = {}): DiscoveredExtensionManifest {
  return {
    manifest: {
      name,
      version,
      dependsOn: [],
      cliCommands: [],
      ...overrides,
    },
    manifestPath: `/fake/${name}/skeem-extension.yaml`,
    rootDir: `/fake/${name}`,
  };
}

describe("extension registry status", () => {
  test("classifies available manifests when nothing is installed", () => {
    const entries = buildExtensionStatus({
      manifests: [manifest("memory", "0.1.0", { description: "Agent memory" })],
      installedRows: [],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        name: "memory",
        state: "available",
        manifest: expect.objectContaining({ version: "0.1.0", description: "Agent memory" }),
      }),
    ]);
    expect(entries[0]?.installed).toBeUndefined();
  });

  test("classifies installed and version-drift entries", () => {
    const entries = buildExtensionStatus({
      manifests: [
        manifest("memory", "0.2.0"),
        manifest("kg", "0.1.0"),
      ],
      installedRows: [
        { name: "memory", version: "0.2.0", installed_at: "2026-04-01T00:00:00.000Z" },
        { name: "kg", version: "0.0.9" },
      ],
    });

    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    expect(byName.get("memory")?.state).toBe("installed");
    expect(byName.get("memory")?.installed?.installedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(byName.get("kg")?.state).toBe("version_drift");
    expect(byName.get("kg")?.installed?.version).toBe("0.0.9");
  });

  test("surfaces installed entries that have no matching local manifest", () => {
    const entries = buildExtensionStatus({
      manifests: [],
      installedRows: [{ name: "ghost", version: "9.9.9" }],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        name: "ghost",
        state: "installed_without_manifest",
        installed: { version: "9.9.9" },
      }),
    ]);
    expect(entries[0]?.manifest).toBeUndefined();
  });

  test("summary counts each registry state", () => {
    const entries = buildExtensionStatus({
      manifests: [
        manifest("memory", "0.2.0"),
        manifest("kg", "0.1.0"),
        manifest("notes", "1.0.0"),
      ],
      installedRows: [
        { name: "memory", version: "0.2.0" },
        { name: "kg", version: "0.0.9" },
        { name: "ghost", version: "1.2.3" },
      ],
    });

    expect(summarizeExtensionStatus(entries)).toEqual({
      total: 4,
      available: 1,
      installed: 1,
      versionDrift: 1,
      installedWithoutManifest: 1,
    });
  });
});
