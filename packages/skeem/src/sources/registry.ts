import { createTmdbSource } from "@skeems/tmdb";
import { createOpenLibrarySource } from "@skeems/openlibrary";
import { createWikidataSource } from "@skeems/wikidata";

import { UsageError } from "../errors/index.js";
import type { ReadSourceConnectionConfig } from "../types/index.js";
import type { ReadSource, ReadSourceFactory } from "./types.js";

const FACTORIES: Record<string, ReadSourceFactory> = {
  tmdb: createTmdbSource as unknown as ReadSourceFactory,
  openlibrary: createOpenLibrarySource as unknown as ReadSourceFactory,
  wikidata: createWikidataSource as unknown as ReadSourceFactory,
};

export function listSupportedSourceTypes(): string[] {
  return Object.keys(FACTORIES).sort();
}

export function isSupportedSourceType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(FACTORIES, type);
}

export interface ConfiguredSourceSummary {
  name: string;
  type: string;
  supported: boolean;
}

export function summarizeConfiguredSources(
  sources: Record<string, ReadSourceConnectionConfig>,
): ConfiguredSourceSummary[] {
  return Object.entries(sources)
    .map(([name, config]) => ({
      name,
      type: config.type,
      supported: isSupportedSourceType(config.type),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function instantiateSource(
  name: string,
  sources: Record<string, ReadSourceConnectionConfig>,
): Promise<ReadSource> {
  const config = sources[name];
  if (!config) {
    throw new UsageError(
      `Source "${name}" is not configured. Add it under the "sources" config section.`,
    );
  }
  const factory = FACTORIES[config.type];
  if (!factory) {
    throw new UsageError(
      `Source "${name}" uses unsupported type "${config.type}" (supported: ${listSupportedSourceTypes().join(", ")}).`,
    );
  }
  const source = factory();
  await source.connect(config);
  return source;
}
