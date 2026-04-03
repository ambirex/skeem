import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";

import type { CliGlobalOptions, ResolvedConfig } from "../types/index.js";

interface RawConfig {
  adapter?: string;
  connection?: {
    url?: string;
    token?: string;
    [key: string]: unknown;
  };
  schema?: {
    aliases?: Record<string, string>;
    exclude?: string[];
  };
  extensions?: Record<string, unknown>;
  profiles?: Record<string, Omit<RawConfig, "profiles" | "default">>;
  default?: string;
  cache?: {
    ttl_seconds?: number;
    ttl_ms?: number;
  };
}

const LOCAL_CONFIG_NAME = ".skeemrc.yaml";

export async function loadConfig(startDir: string, cli: CliGlobalOptions): Promise<ResolvedConfig> {
  const localConfigPath = await findLocalConfig(startDir);
  const globalConfigPath = path.join(homedir(), ".config", "skeem", "config.yaml");

  const globalConfig = await readConfig(globalConfigPath);
  const localConfig = localConfigPath ? await readConfig(localConfigPath) : {};

  const merged = mergeConfigs(globalConfig, localConfig);
  const selectedProfile = cli.profile ?? process.env.SKEEM_PROFILE ?? merged.default;
  const profiled = selectedProfile && merged.profiles?.[selectedProfile]
    ? mergeConfigs(merged, merged.profiles[selectedProfile])
    : merged;

  const withEnvOverrides = applyEnvOverrides(profiled);
  const withCliOverrides = applyCliOverrides(withEnvOverrides, cli);
  const resolved = interpolateEnv(withCliOverrides) as RawConfig;

  const rootDir = localConfigPath ? path.dirname(localConfigPath) : startDir;
  const adapter = resolved.adapter ?? "directus";
  const url = resolved.connection?.url;

  if (!url) {
    throw new Error("Missing connection URL. Set it in .skeemrc.yaml, ~/.config/skeem/config.yaml, SKEEM_URL, or --url.");
  }

  return {
    adapter,
    connection: {
      ...(resolved.connection ?? {}),
      url,
    },
    ...(selectedProfile ? { profile: selectedProfile } : {}),
    rootDir,
    ...((localConfigPath ?? (await exists(globalConfigPath) ? globalConfigPath : undefined))
      ? { configPath: localConfigPath ?? globalConfigPath }
      : {}),
    schema: {
      aliases: resolved.schema?.aliases ?? {},
      exclude: resolved.schema?.exclude ?? ["directus_*"],
    },
    extensions: resolved.extensions ?? {},
    cache: {
      ttlMs: resolved.cache?.ttl_ms ?? (resolved.cache?.ttl_seconds ? resolved.cache.ttl_seconds * 1000 : 60 * 60 * 1000),
    },
  };
}

async function findLocalConfig(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);

  for (;;) {
    const candidate = path.join(current, LOCAL_CONFIG_NAME);
    if (await exists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function readConfig(configPath: string): Promise<RawConfig> {
  if (!(await exists(configPath))) {
    return {};
  }

  const contents = await readFile(configPath, "utf8");
  const parsed = YAML.parse(contents);
  return (parsed ?? {}) as RawConfig;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function mergeConfigs(base: RawConfig, override: RawConfig): RawConfig {
  return {
    ...base,
    ...override,
    connection: {
      ...(base.connection ?? {}),
      ...(override.connection ?? {}),
    },
    schema: {
      ...(base.schema ?? {}),
      ...(override.schema ?? {}),
      aliases: {
        ...(base.schema?.aliases ?? {}),
        ...(override.schema?.aliases ?? {}),
      },
      ...(override.schema?.exclude ?? base.schema?.exclude ? { exclude: override.schema?.exclude ?? base.schema?.exclude } : {}),
    },
    extensions: {
      ...(base.extensions ?? {}),
      ...(override.extensions ?? {}),
    },
    profiles: {
      ...(base.profiles ?? {}),
      ...(override.profiles ?? {}),
    },
    cache: {
      ...(base.cache ?? {}),
      ...(override.cache ?? {}),
    },
  };
}

function applyEnvOverrides(config: RawConfig): RawConfig {
  return mergeConfigs(config, {
    ...(process.env.SKEEM_ADAPTER ? { adapter: process.env.SKEEM_ADAPTER } : {}),
    ...(process.env.SKEEM_URL || process.env.SKEEM_TOKEN
      ? {
          connection: {
            ...(process.env.SKEEM_URL ? { url: process.env.SKEEM_URL } : {}),
            ...(process.env.SKEEM_TOKEN ? { token: process.env.SKEEM_TOKEN } : {}),
          },
        }
      : {}),
  });
}

function applyCliOverrides(config: RawConfig, cli: CliGlobalOptions): RawConfig {
  return mergeConfigs(config, {
    ...(cli.adapter ? { adapter: cli.adapter } : {}),
    ...(cli.url || cli.token
      ? {
          connection: {
            ...(cli.url ? { url: cli.url } : {}),
            ...(cli.token ? { token: cli.token } : {}),
          },
        }
      : {}),
  });
}

function interpolateEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => process.env[name] ?? "");
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, interpolateEnv(nestedValue)]),
    );
  }

  return value;
}
